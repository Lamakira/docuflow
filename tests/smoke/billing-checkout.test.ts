import { beforeEach, describe, expect, it } from "vitest";
import { FakeBillingProvider } from "../fakes/billingProvider";
import { resetDb } from "../helpers/db";
import { inSeededWorkspace } from "../helpers/workspace";

/**
 * Phase 8 ticket #144: Plan and seats in DocuFlow, Checkout on Stripe.
 * Seams: billing commands + BillingProvider fake (Checkout pending → Active,
 * seat increase/decrease, seeded-workspace refusal). Characterization of the
 * billing BFF is a separate suite.
 */

const CHECKOUT = {
  planKey: "pro" as const,
  seatQuantity: 3,
  successUrl: "https://app.docuflow.test/billing/return",
  cancelUrl: "https://app.docuflow.test/billing/cancel",
};

const TRIAL_WORKSPACE_ID = "trialing";
const PERIOD_END = new Date("2026-10-01T00:00:00.000Z");
const SYSTEM = { kind: "system" as const };

async function plantTrialWorkspace(id = TRIAL_WORKSPACE_ID) {
  const { db } = await import("../../server/db");
  const { workspaces, workspaceRoles } = await import("../../shared/schema");
  const { startTrial } = await import("../../server/modules/billing");
  const { runWithWorkspaceContext } = await import("../../server/workspaceContext");
  await db.insert(workspaces).values({ id, name: "Trial" });
  await db.insert(workspaceRoles).values({
    id: `${id}-owner`,
    workspaceId: id,
    slug: "owner",
    name: "Owner",
  });
  await runWithWorkspaceContext({ workspaceId: id }, () =>
    startTrial(SYSTEM, { now: new Date("2026-01-01T00:00:00.000Z") })
  );
}

async function billingJobs() {
  const { db } = await import("../../server/db");
  const { createJobsPort } = await import("../../server/jobs");
  const { BILLING_PROJECT_JOB, BILLING_PROJECT_JOB_TYPE } = await import(
    "../../server/modules/billing"
  );
  return createJobsPort({
    db,
    types: { [BILLING_PROJECT_JOB]: BILLING_PROJECT_JOB_TYPE },
  });
}

describe("seeded Workspace Checkout", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("refuses Checkout and keeps Plan legacy with no Stripe objects", async () => {
    const { startCheckout, getBillingProjection, SeededWorkspaceCheckoutError } = await import(
      "../../server/modules/billing"
    );
    const provider = new FakeBillingProvider();

    await expect(
      inSeededWorkspace(() => startCheckout(CHECKOUT, { kind: "system" }, provider))
    ).rejects.toBeInstanceOf(SeededWorkspaceCheckoutError);

    const pin = await inSeededWorkspace(() => getBillingProjection());
    expect(pin).toMatchObject({
      planKey: "legacy",
      billingState: "Active",
      stripeCustomerId: null,
      stripeSubscriptionId: null,
    });
    expect(provider.checkouts).toEqual([]);
  });
});

describe("Checkout pending then Active", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("returns a hosted URL, stays Trialing until the projection Job, then Active with purchased seats", async () => {
    const {
      startCheckout,
      getBillingProjection,
      ingestBillingWebhook,
      handleProjectBillingJob,
      BILLING_PROJECT_JOB,
    } = await import("../../server/modules/billing");
    const { runWithWorkspaceContext } = await import("../../server/workspaceContext");
    const { createJobRunner } = await import("../../server/worker");
    const { db } = await import("../../server/db");
    const { jobs } = await import("../../shared/schema");

    await plantTrialWorkspace();
    const provider = new FakeBillingProvider();

    const session = await runWithWorkspaceContext({ workspaceId: TRIAL_WORKSPACE_ID }, () =>
      startCheckout(CHECKOUT, SYSTEM, provider)
    );
    expect(session.url).toBe("https://checkout.stripe.test/c/cs_fake_1");
    expect(session.providerSessionId).toBe("cs_fake_1");

    const pending = await runWithWorkspaceContext({ workspaceId: TRIAL_WORKSPACE_ID }, () =>
      getBillingProjection()
    );
    expect(pending).toMatchObject({
      planKey: "trial",
      billingState: "Trialing",
      purchasedSeatCapacity: 1,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
    });

    provider.subscriptions.set("sub_fake_1", {
      providerCustomerId: "cus_fake_1",
      providerSubscriptionId: "sub_fake_1",
      planKey: "pro",
      seatQuantity: 3,
      currentPeriodEnd: PERIOD_END,
      cancelAtPeriodEnd: false,
      collectionState: "Current",
    });

    const jobsPort = await billingJobs();
    await ingestBillingWebhook({
      provider,
      jobs: jobsPort,
      payload: JSON.stringify({
        providerEventId: "evt_checkout_1",
        type: "checkout.session.completed",
        objectId: "cs_fake_1",
      }),
      signature: "signed",
    });

    const stillPending = await runWithWorkspaceContext({ workspaceId: TRIAL_WORKSPACE_ID }, () =>
      getBillingProjection()
    );
    expect(stillPending.billingState).toBe("Trialing");
    expect(stillPending.planKey).toBe("trial");
    expect(await db.select().from(jobs)).toHaveLength(1);

    const worker = createJobRunner({
      role: "worker",
      jobs: jobsPort,
      handlers: {
        [BILLING_PROJECT_JOB]: (job) => handleProjectBillingJob(job, provider),
      },
      claimerId: "worker-1",
    });
    expect((await worker.runOne())?.type).toBe(BILLING_PROJECT_JOB);

    const active = await runWithWorkspaceContext({ workspaceId: TRIAL_WORKSPACE_ID }, () =>
      getBillingProjection()
    );
    expect(active).toMatchObject({
      planKey: "pro",
      billingState: "Active",
      purchasedSeatCapacity: 3,
      stripeCustomerId: "cus_fake_1",
      stripeSubscriptionId: "sub_fake_1",
    });
    expect(active.periodEndsAt).toEqual(PERIOD_END);
  });
});

const PAID_WORKSPACE_ID = "paid";
const SUBSCRIPTION_ID = "sub_fake_1";

async function plantPaidWorkspace(purchasedSeatCapacity = 3) {
  const { db } = await import("../../server/db");
  const { workspaces, workspaceRoles, workspaceBilling } = await import("../../shared/schema");
  await db.insert(workspaces).values({ id: PAID_WORKSPACE_ID, name: "Paid" });
  await db.insert(workspaceRoles).values({
    id: `${PAID_WORKSPACE_ID}-owner`,
    workspaceId: PAID_WORKSPACE_ID,
    slug: "owner",
    name: "Owner",
  });
  await db.insert(workspaceBilling).values({
    workspaceId: PAID_WORKSPACE_ID,
    planKey: "pro",
    registryVersion: 1,
    billingState: "Active",
    purchasedSeatCapacity,
    authorizationVersion: 1,
    stripeCustomerId: "cus_fake_1",
    stripeSubscriptionId: SUBSCRIPTION_ID,
    periodEndsAt: PERIOD_END,
  });
}

async function plantPaidMembers(count: number) {
  const { db } = await import("../../server/db");
  const { memberships, users } = await import("../../shared/schema");
  for (let i = 0; i < count; i += 1) {
    const [user] = await db
      .insert(users)
      .values({
        email: `paid-${i}@test.invalid`,
        firstName: `P${i}`,
      })
      .returning();
    await db.insert(memberships).values({
      userId: user.id,
      workspaceId: PAID_WORKSPACE_ID,
      workspaceRoleId: `${PAID_WORKSPACE_ID}-owner`,
    });
  }
}

describe("seat changes", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("applies an increase immediately and tells the provider afterwards", async () => {
    const { changeSeats, getBillingProjection } = await import("../../server/modules/billing");
    const { runWithWorkspaceContext } = await import("../../server/workspaceContext");
    const provider = new FakeBillingProvider();
    await plantPaidWorkspace(3);

    const next = await runWithWorkspaceContext({ workspaceId: PAID_WORKSPACE_ID }, () =>
      changeSeats(5, SYSTEM, provider)
    );
    expect(next.purchasedSeatCapacity).toBe(5);

    const pin = await runWithWorkspaceContext({ workspaceId: PAID_WORKSPACE_ID }, () =>
      getBillingProjection()
    );
    expect(pin.purchasedSeatCapacity).toBe(5);
    expect(pin.authorizationVersion).toBe(2);
    expect(provider.seatUpdates).toEqual([
      {
        providerSubscriptionId: SUBSCRIPTION_ID,
        seatQuantity: 5,
        proration: "create_prorations",
      },
    ]);
  });

  it("applies a decrease at period end, floored at consumption, then tells the provider", async () => {
    const {
      changeSeats,
      applyPendingSeatDecrease,
      getBillingProjection,
      countConsumedSeats,
      SeatCapacityFloorError,
    } = await import("../../server/modules/billing");
    const { runWithWorkspaceContext } = await import("../../server/workspaceContext");
    const provider = new FakeBillingProvider();

    await plantPaidWorkspace(5);
    await plantPaidMembers(2);
    await expect(
      runWithWorkspaceContext({ workspaceId: PAID_WORKSPACE_ID }, () => countConsumedSeats())
    ).resolves.toBe(2);

    await expect(
      runWithWorkspaceContext({ workspaceId: PAID_WORKSPACE_ID }, () =>
        changeSeats(1, SYSTEM, provider)
      )
    ).rejects.toBeInstanceOf(SeatCapacityFloorError);

    const scheduled = await runWithWorkspaceContext({ workspaceId: PAID_WORKSPACE_ID }, () =>
      changeSeats(3, SYSTEM, provider)
    );
    expect(scheduled.purchasedSeatCapacity).toBe(5);
    expect(provider.seatUpdates).toEqual([]);

    await expect(
      runWithWorkspaceContext({ workspaceId: PAID_WORKSPACE_ID }, () =>
        applyPendingSeatDecrease(SYSTEM, provider, { now: new Date("2026-09-01T00:00:00.000Z") })
      )
    ).rejects.toThrow(/period/i);

    const applied = await runWithWorkspaceContext({ workspaceId: PAID_WORKSPACE_ID }, () =>
      applyPendingSeatDecrease(SYSTEM, provider, { now: PERIOD_END })
    );
    expect(applied.purchasedSeatCapacity).toBe(3);
    const pin = await runWithWorkspaceContext({ workspaceId: PAID_WORKSPACE_ID }, () =>
      getBillingProjection()
    );
    expect(pin.purchasedSeatCapacity).toBe(3);
    expect(provider.seatUpdates).toEqual([
      {
        providerSubscriptionId: SUBSCRIPTION_ID,
        seatQuantity: 3,
        proration: "none",
      },
    ]);
  });

  it("applies a scheduled decrease when the projection Job rolls the period, not Stripe's still-high quantity", async () => {
    const {
      changeSeats,
      getBillingProjection,
      ingestBillingWebhook,
      handleProjectBillingJob,
      BILLING_PROJECT_JOB,
    } = await import("../../server/modules/billing");
    const { runWithWorkspaceContext } = await import("../../server/workspaceContext");
    const { createJobRunner } = await import("../../server/worker");

    const provider = new FakeBillingProvider();
    const nextPeriodEnd = new Date("2026-11-01T00:00:00.000Z");
    await plantPaidWorkspace(5);
    await runWithWorkspaceContext({ workspaceId: PAID_WORKSPACE_ID }, () =>
      changeSeats(3, SYSTEM, provider)
    );

    provider.subscriptions.set(SUBSCRIPTION_ID, {
      providerCustomerId: "cus_fake_1",
      providerSubscriptionId: SUBSCRIPTION_ID,
      planKey: "pro",
      seatQuantity: 5,
      currentPeriodEnd: nextPeriodEnd,
      cancelAtPeriodEnd: false,
      collectionState: "Current",
    });

    const jobsPort = await billingJobs();
    await ingestBillingWebhook({
      provider,
      jobs: jobsPort,
      payload: JSON.stringify({
        providerEventId: "evt_period_roll",
        type: "customer.subscription.updated",
        objectId: SUBSCRIPTION_ID,
      }),
      signature: "signed",
    });

    const worker = createJobRunner({
      role: "worker",
      jobs: jobsPort,
      handlers: {
        [BILLING_PROJECT_JOB]: (job) => handleProjectBillingJob(job, provider),
      },
      claimerId: "worker-1",
    });
    expect((await worker.runOne())?.type).toBe(BILLING_PROJECT_JOB);

    const pin = await runWithWorkspaceContext({ workspaceId: PAID_WORKSPACE_ID }, () =>
      getBillingProjection()
    );
    expect(pin.purchasedSeatCapacity).toBe(3);
    expect(pin.periodEndsAt).toEqual(nextPeriodEnd);
    expect(provider.seatUpdates).toEqual([
      {
        providerSubscriptionId: SUBSCRIPTION_ID,
        seatQuantity: 3,
        proration: "none",
      },
    ]);
  });

  it("does not let a stale provider quantity overwrite a local seat increase", async () => {
    const {
      changeSeats,
      getBillingProjection,
      ingestBillingWebhook,
      handleProjectBillingJob,
      BILLING_PROJECT_JOB,
    } = await import("../../server/modules/billing");
    const { runWithWorkspaceContext } = await import("../../server/workspaceContext");
    const { createJobRunner } = await import("../../server/worker");

    const provider = new FakeBillingProvider();
    await plantPaidWorkspace(3);
    await runWithWorkspaceContext({ workspaceId: PAID_WORKSPACE_ID }, () =>
      changeSeats(5, SYSTEM, provider)
    );

    provider.subscriptions.set(SUBSCRIPTION_ID, {
      providerCustomerId: "cus_fake_1",
      providerSubscriptionId: SUBSCRIPTION_ID,
      planKey: "pro",
      seatQuantity: 3,
      currentPeriodEnd: PERIOD_END,
      cancelAtPeriodEnd: false,
      collectionState: "Current",
    });

    const jobsPort = await billingJobs();
    await ingestBillingWebhook({
      provider,
      jobs: jobsPort,
      payload: JSON.stringify({
        providerEventId: "evt_stale_qty",
        type: "customer.subscription.updated",
        objectId: SUBSCRIPTION_ID,
      }),
      signature: "signed",
    });

    const worker = createJobRunner({
      role: "worker",
      jobs: jobsPort,
      handlers: {
        [BILLING_PROJECT_JOB]: (job) => handleProjectBillingJob(job, provider),
      },
      claimerId: "worker-1",
    });
    expect((await worker.runOne())?.type).toBe(BILLING_PROJECT_JOB);

    const pin = await runWithWorkspaceContext({ workspaceId: PAID_WORKSPACE_ID }, () =>
      getBillingProjection()
    );
    expect(pin.purchasedSeatCapacity).toBe(5);
  });
});

describe("hosted payment-method update", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("returns a hosted provider URL, including from ReadOnly", async () => {
    const {
      startPaymentMethodUpdate,
      markPastDue,
      exhaustDunning,
      getBillingProjection,
    } = await import("../../server/modules/billing");
    const { runWithWorkspaceContext } = await import("../../server/workspaceContext");
    const provider = new FakeBillingProvider();
    await plantPaidWorkspace(3);

    const session = await runWithWorkspaceContext({ workspaceId: PAID_WORKSPACE_ID }, () =>
      startPaymentMethodUpdate(
        { returnUrl: "https://app.docuflow.test/billing/return" },
        SYSTEM,
        provider
      )
    );
    expect(session.url).toBe("https://billing.stripe.test/p/bps_fake_1");
    expect(provider.paymentMethodUpdates).toEqual([
      { providerCustomerId: "cus_fake_1", returnUrl: "https://app.docuflow.test/billing/return" },
    ]);

    await runWithWorkspaceContext({ workspaceId: PAID_WORKSPACE_ID }, () => markPastDue(SYSTEM));
    await runWithWorkspaceContext({ workspaceId: PAID_WORKSPACE_ID }, () => exhaustDunning(SYSTEM));
    const pin = await runWithWorkspaceContext({ workspaceId: PAID_WORKSPACE_ID }, () =>
      getBillingProjection()
    );
    expect(pin.billingState).toBe("ReadOnly");

    const recovered = await runWithWorkspaceContext({ workspaceId: PAID_WORKSPACE_ID }, () =>
      startPaymentMethodUpdate(
        { returnUrl: "https://app.docuflow.test/billing/return" },
        SYSTEM,
        provider
      )
    );
    expect(recovered.url).toMatch(/^https:\/\/billing\.stripe\.test\/p\//);
    expect(provider.paymentMethodUpdates).toHaveLength(2);
  });

  it("refuses a Workspace with no Stripe customer", async () => {
    const { startPaymentMethodUpdate } = await import("../../server/modules/billing");
    const provider = new FakeBillingProvider();

    await expect(
      inSeededWorkspace(() =>
        startPaymentMethodUpdate(
          { returnUrl: "https://app.docuflow.test/billing/return" },
          SYSTEM,
          provider
        )
      )
    ).rejects.toThrow(/payment method|Stripe customer/i);
    expect(provider.paymentMethodUpdates).toEqual([]);
  });
});

import { and, desc, eq, inArray } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Express } from "express";
import { SEEDED_WORKSPACE_ID, auditEvents, workspaceBilling } from "../../shared/schema";
import type { ProviderSubscription } from "../../server/modules/billing/billingProvider";
import { FakeBillingProvider } from "../fakes/billingProvider";
import { makeApp } from "../helpers/app";
import { registerUser, setWorkspaceRole, type TestUser } from "../helpers/auth";
import { resetDb, ownerDb } from "../helpers/db";

/**
 * Cancel at period end and its undo from the Billing page (F102). Stripe is
 * asked first, then the flag and its Audit Event follow; Stripe's next event
 * keeps the flag. Only a live Subscription (Active or Past due) can be
 * cancelled: the Legacy Workspace and an Offered Plan have none. Seam: the
 * billing BFF, with the process-wide provider routed to the port fake.
 */

const SUBSCRIPTION_ID = "sub_cancel";
const PERIOD_END = new Date("2026-12-01T00:00:00.000Z");

const SUBSCRIPTION: ProviderSubscription = {
  providerCustomerId: "cus_cancel",
  providerSubscriptionId: SUBSCRIPTION_ID,
  planKey: "growth",
  interval: "annual",
  seatQuantity: 3,
  currentPeriodEnd: PERIOD_END,
  cancelAtPeriodEnd: false,
  collectionState: "Current",
  unitAmountMinor: 1200,
  currency: "usd",
};

async function pinSeeded(values: Partial<typeof workspaceBilling.$inferInsert>) {
  await ownerDb.update(workspaceBilling).set(values).where(eq(workspaceBilling.workspaceId, SEEDED_WORKSPACE_ID));
}

/** The seeded Workspace on a Growth annual Subscription, as Checkout leaves it. */
async function paying(values: Partial<typeof workspaceBilling.$inferInsert> = {}) {
  await pinSeeded({
    planKey: "growth",
    registryVersion: 2,
    billingState: "Active",
    billingInterval: "annual",
    purchasedSeatCapacity: 3,
    stripeCustomerId: SUBSCRIPTION.providerCustomerId,
    stripeSubscriptionId: SUBSCRIPTION_ID,
    periodEndsAt: PERIOD_END,
    unitAmountMinor: 1200,
    currency: "usd",
    ...values,
  });
}

async function pin() {
  const [row] = await ownerDb
    .select()
    .from(workspaceBilling)
    .where(eq(workspaceBilling.workspaceId, SEEDED_WORKSPACE_ID));
  return row;
}

async function cancelEvents() {
  return ownerDb
    .select()
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.workspaceId, SEEDED_WORKSPACE_ID),
        inArray(auditEvents.action, ["billing.cancel_at_period_end", "billing.cancel_at_period_end_undone"])
      )
    )
    .orderBy(desc(auditEvents.createdAt));
}

/** Route the process-wide provider to a port fake that knows the Subscription. */
async function useFake(): Promise<FakeBillingProvider> {
  const { billingProvider } = await import("../../server/modules/billing");
  const fake = new FakeBillingProvider();
  fake.subscriptions.set(SUBSCRIPTION_ID, SUBSCRIPTION);
  vi.spyOn(billingProvider, "setCancelAtPeriodEnd").mockImplementation((update) => fake.setCancelAtPeriodEnd(update));
  return fake;
}

/** Stripe's `customer.subscription.updated`, taken in and projected by the Worker. */
async function stripeEvent(fake: FakeBillingProvider, providerEventId: string) {
  const { db } = await import("../../server/db");
  const { createJobsPort } = await import("../../server/jobs");
  const { createJobRunner } = await import("../../server/worker");
  const billing = await import("../../server/modules/billing");
  const jobs = createJobsPort({ db, types: { [billing.BILLING_PROJECT_JOB]: billing.BILLING_PROJECT_JOB_TYPE } });
  await billing.ingestBillingWebhook({
    provider: fake,
    jobs,
    payload: JSON.stringify({ providerEventId, type: "customer.subscription.updated", objectId: SUBSCRIPTION_ID }),
    signature: "signed",
  });
  const runner = createJobRunner({
    role: "worker",
    jobs,
    handlers: { [billing.BILLING_PROJECT_JOB]: (job) => billing.handleProjectBillingJob(job, fake) },
    claimerId: "cancellation-test",
  });
  while (await runner.runOne()) {
    // drain
  }
}

async function owner(app: Express): Promise<TestUser> {
  const user = await registerUser(app);
  await setWorkspaceRole(user.id, "owner");
  return user;
}

describe("cancel at period end from the Billing page", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("asks Stripe first, flags the Subscription, and Stripe's next event keeps it", async () => {
    const app = await makeApp();
    const user = await owner(app);
    await paying();
    const fake = await useFake();

    const before = await user.agent.get("/api/billing/subscription");
    expect(before.body).toMatchObject({ canCancel: true, canKeep: false });

    const res = await user.agent.post("/api/billing/cancel-at-period-end");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      cancelAtPeriodEnd: true,
      canCancel: false,
      canKeep: true,
      consumedSeatCount: 1,
      pendingSeatQuantity: null,
      unitAmountMinor: 1200,
      currency: "usd",
    });
    expect(fake.cancelAtPeriodEndUpdates).toEqual([{ providerSubscriptionId: SUBSCRIPTION_ID, cancel: true }]);
    const events = await cancelEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ action: "billing.cancel_at_period_end", actorKind: "user", actorId: user.id });

    await stripeEvent(fake, "evt_after_cancel");
    expect((await pin()).cancelAtPeriodEnd).toBe(true);

    // A repeat tells Stripe again (idempotent) and writes nothing.
    const again = await user.agent.post("/api/billing/cancel-at-period-end");
    expect(again.status).toBe(200);
    expect(again.body.cancelAtPeriodEnd).toBe(true);
    expect(fake.cancelAtPeriodEndUpdates).toEqual([
      { providerSubscriptionId: SUBSCRIPTION_ID, cancel: true },
      { providerSubscriptionId: SUBSCRIPTION_ID, cancel: true },
    ]);
    expect(await cancelEvents()).toHaveLength(1);
  });

  it("sends Stripe a cancellation the old code flagged but never sent", async () => {
    const app = await makeApp();
    const user = await owner(app);
    await paying({ cancelAtPeriodEnd: true });
    const fake = await useFake();
    expect(fake.subscriptions.get(SUBSCRIPTION_ID)?.cancelAtPeriodEnd).toBe(false);

    const res = await user.agent.post("/api/billing/cancel-at-period-end");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ cancelAtPeriodEnd: true, canKeep: true });
    expect(fake.subscriptions.get(SUBSCRIPTION_ID)?.cancelAtPeriodEnd).toBe(true);
    expect(await cancelEvents()).toEqual([]);

    await stripeEvent(fake, "evt_after_resend");
    expect((await pin()).cancelAtPeriodEnd).toBe(true);
  });

  it("keeps the Subscription again, through Stripe, until the date", async () => {
    const app = await makeApp();
    const user = await owner(app);
    await paying();
    const fake = await useFake();
    await user.agent.post("/api/billing/cancel-at-period-end");

    const kept = await user.agent.post("/api/billing/keep-subscription");
    expect(kept.status).toBe(200);
    expect(kept.body).toMatchObject({ cancelAtPeriodEnd: false, canCancel: true, canKeep: false });
    expect(fake.cancelAtPeriodEndUpdates.at(-1)).toEqual({ providerSubscriptionId: SUBSCRIPTION_ID, cancel: false });
    expect((await cancelEvents())[0]).toMatchObject({
      action: "billing.cancel_at_period_end_undone",
      actorKind: "user",
      actorId: user.id,
    });

    await stripeEvent(fake, "evt_after_keep");
    expect((await pin()).cancelAtPeriodEnd).toBe(false);

    const again = await user.agent.post("/api/billing/keep-subscription");
    expect(again.status).toBe(200);
    expect(fake.cancelAtPeriodEndUpdates.at(-1)).toEqual({ providerSubscriptionId: SUBSCRIPTION_ID, cancel: false });
    expect(await cancelEvents()).toHaveLength(2);
  });

  it("offers it to a Past due Subscription", async () => {
    const app = await makeApp();
    const user = await owner(app);
    await paying({ billingState: "PastDue" });
    const fake = await useFake();

    expect((await user.agent.get("/api/billing/subscription")).body).toMatchObject({ canCancel: true });
    const res = await user.agent.post("/api/billing/cancel-at-period-end");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ billingState: "PastDue", cancelAtPeriodEnd: true });
    expect(fake.cancelAtPeriodEndUpdates).toHaveLength(1);
  });

  it("refuses the Legacy Workspace, which has no Subscription", async () => {
    const app = await makeApp();
    const user = await owner(app);
    const fake = await useFake();

    expect((await user.agent.get("/api/billing/subscription")).body).toMatchObject({
      planKey: "legacy",
      canCancel: false,
      canKeep: false,
    });
    const res = await user.agent.post("/api/billing/cancel-at-period-end");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message: "There is no Subscription to cancel" });
    expect(fake.cancelAtPeriodEndUpdates).toEqual([]);
    expect((await pin()).cancelAtPeriodEnd).toBe(false);
    expect(await cancelEvents()).toEqual([]);
  });

  it("refuses an Offered Plan, which has no Subscription", async () => {
    const app = await makeApp();
    const user = await owner(app);
    await pinSeeded({ planKey: "growth", registryVersion: 2, billingState: "Trialing", trialEndsAt: PERIOD_END });
    const fake = await useFake();

    expect((await user.agent.get("/api/billing/subscription")).body).toMatchObject({ canCancel: false, canKeep: false });
    const res = await user.agent.post("/api/billing/cancel-at-period-end");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message: "There is no Subscription to cancel" });
    expect(fake.cancelAtPeriodEndUpdates).toEqual([]);
  });

  it("leaves the flag and the Audit Log as they were when Stripe refuses", async () => {
    const { BillingProviderError } = await import("../../server/modules/billing");
    const app = await makeApp();
    const user = await owner(app);
    await paying();
    const fake = await useFake();
    fake.refusal = new BillingProviderError("Stripe could not complete the request: try again");

    const res = await user.agent.post("/api/billing/cancel-at-period-end");
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ message: "Stripe could not complete the request: try again" });
    expect((await pin()).cancelAtPeriodEnd).toBe(false);
    expect(await cancelEvents()).toEqual([]);
  });

  it("takes the flag as set when Stripe's event lands while Stripe answers, without a second Audit Event", async () => {
    const { billingProvider } = await import("../../server/modules/billing");
    const app = await makeApp();
    const user = await owner(app);
    await paying();
    const fake = new FakeBillingProvider();
    vi.spyOn(billingProvider, "setCancelAtPeriodEnd").mockImplementation(async (update) => {
      await fake.setCancelAtPeriodEnd(update);
      await pinSeeded({ cancelAtPeriodEnd: true });
    });

    const res = await user.agent.post("/api/billing/cancel-at-period-end");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ cancelAtPeriodEnd: true, canKeep: true });
    expect(await cancelEvents()).toEqual([]);
  });

  it("refuses when the Subscription was replaced while Stripe answered", async () => {
    const { billingProvider } = await import("../../server/modules/billing");
    const app = await makeApp();
    const user = await owner(app);
    await paying();
    const fake = new FakeBillingProvider();
    vi.spyOn(billingProvider, "setCancelAtPeriodEnd").mockImplementation(async (update) => {
      await fake.setCancelAtPeriodEnd(update);
      await pinSeeded({ stripeSubscriptionId: "sub_replaced" });
    });

    const res = await user.agent.post("/api/billing/cancel-at-period-end");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message: "There is no Subscription to cancel" });
    expect((await pin()).cancelAtPeriodEnd).toBe(false);
    expect(await cancelEvents()).toEqual([]);
  });

  it("answers keep with nothing done when nothing is cancelling, Subscription or not", async () => {
    const app = await makeApp();
    const user = await owner(app);
    const fake = await useFake();

    const res = await user.agent.post("/api/billing/keep-subscription");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ planKey: "legacy", cancelAtPeriodEnd: false });
    expect(fake.cancelAtPeriodEndUpdates).toEqual([]);
  });

  it("catches up from Stripe's event when the write fails after Stripe agreed", async () => {
    const { db } = await import("../../server/db");
    const { billingProvider } = await import("../../server/modules/billing");
    const app = await makeApp();
    const user = await owner(app);
    await paying();
    const fake = new FakeBillingProvider();
    fake.subscriptions.set(SUBSCRIPTION_ID, SUBSCRIPTION);
    vi.spyOn(billingProvider, "setCancelAtPeriodEnd").mockImplementation(async (update) => {
      await fake.setCancelAtPeriodEnd(update);
      // The database goes away between Stripe's answer and our write.
      vi.spyOn(db, "transaction").mockRejectedValueOnce(new Error("Connection terminated unexpectedly"));
    });

    const res = await user.agent.post("/api/billing/cancel-at-period-end");
    expect(res.status).toBe(500);
    expect((await pin()).cancelAtPeriodEnd).toBe(false);
    expect(fake.subscriptions.get(SUBSCRIPTION_ID)?.cancelAtPeriodEnd).toBe(true);

    await stripeEvent(fake, "evt_catch_up");
    expect((await pin()).cancelAtPeriodEnd).toBe(true);
    expect((await user.agent.get("/api/billing/subscription")).body).toMatchObject({ canCancel: false, canKeep: true });
  });
});

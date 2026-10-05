import { beforeEach, describe, expect, it, vi } from "vitest";
import { count, desc, eq } from "drizzle-orm";
import {
  auditEvents,
  notifications,
  outboxEvents,
  supportRequestEntries,
  supportRequests,
  workspaceBilling,
} from "@shared/schema";
import { makeApp } from "../helpers/app";
import {
  registerPlatformStaff,
  registerUser,
  setWorkspaceRole,
} from "../helpers/auth";
import { createCrmProject, createDocument, createTask, startTimer } from "../helpers/fixtures";
import { resetDb } from "../helpers/db";
import { inSeededWorkspace, plantParallelWorkspace } from "../helpers/workspace";
import { FakeBillingProvider } from "../fakes/billingProvider";
import { subscriptionUpdateCalls } from "../fakes/stripe";
import { emailsTo, failNextSend, resetEmails } from "../fakes/resend";

/**
 * Back office (#314). Platform Staff see every Workspace's billing, disputes,
 * Support Requests and platform statistics, and act on a few of them. The seam
 * is HTTP for the routes, the port fake for the billing webhooks, and the
 * Resend fake for what a customer is told.
 *
 * The back office never reads Workspace content: the only way to that is the
 * grant or break-glass route (#300), asserted at the end.
 */

// The process-wide BillingProvider reads Stripe credentials when `server/config.ts`
// loads, and the helpers below load it at import. The aliased `stripe` fake answers
// the provider, so nothing leaves the process (ADR-0018).
vi.hoisted(() => {
  process.env.STRIPE_SECRET_KEY = "sk_test_back-office-harness";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_back-office-harness";
});

const SEEDED = "seeded";
const DAY_MS = 24 * 60 * 60 * 1000;

type PinValues = Partial<typeof workspaceBilling.$inferInsert>;

async function patchPin(values: PinValues, workspaceId = SEEDED): Promise<void> {
  const { db } = await import("../../server/db");
  const { runWithWorkspaceContext } = await import("../../server/workspaceContext");
  await runWithWorkspaceContext({ workspaceId }, () =>
    db.update(workspaceBilling).set(values).where(eq(workspaceBilling.workspaceId, workspaceId)),
  );
}

async function pinOf(workspaceId = SEEDED) {
  const { db } = await import("../../server/db");
  const { runWithWorkspaceContext } = await import("../../server/workspaceContext");
  const [row] = await runWithWorkspaceContext({ workspaceId }, () =>
    db.select().from(workspaceBilling).where(eq(workspaceBilling.workspaceId, workspaceId)),
  );
  return row;
}

async function auditCount(workspaceId = SEEDED): Promise<number> {
  const { db } = await import("../../server/db");
  const { runWithWorkspaceContext } = await import("../../server/workspaceContext");
  const [row] = await runWithWorkspaceContext({ workspaceId }, () => db.select({ n: count() }).from(auditEvents));
  return Number(row.n);
}

async function auditActions(workspaceId = SEEDED) {
  const { db } = await import("../../server/db");
  const { runWithWorkspaceContext } = await import("../../server/workspaceContext");
  return runWithWorkspaceContext({ workspaceId }, () =>
    db
      .select({
        action: auditEvents.action,
        actorKind: auditEvents.actorKind,
        actorId: auditEvents.actorId,
        payload: auditEvents.payload,
      })
      .from(auditEvents)
      .orderBy(desc(auditEvents.createdAt)),
  );
}

async function entitlementsChangedEvents(workspaceId = SEEDED) {
  const { db } = await import("../../server/db");
  const { runWithWorkspaceContext } = await import("../../server/workspaceContext");
  return runWithWorkspaceContext({ workspaceId }, () =>
    db.select().from(outboxEvents).where(eq(outboxEvents.type, "billing.entitlements_changed")),
  );
}

async function trialing(endsAt: Date, planKey = "trial") {
  await patchPin({
    planKey,
    registryVersion: 2,
    billingState: "Trialing",
    purchasedSeatCapacity: 3,
    trialEndsAt: endsAt,
    stripeSubscriptionId: null,
  });
}

async function payingSubscription(values: PinValues = {}) {
  await patchPin({
    planKey: "growth",
    registryVersion: 2,
    billingState: "Active",
    purchasedSeatCapacity: 3,
    stripeCustomerId: "cus_back_office",
    stripeSubscriptionId: "sub_back_office",
    billingInterval: "monthly",
    trialEndsAt: null,
    periodEndsAt: new Date(Date.now() + 20 * DAY_MS),
    ...values,
  });
}

async function seededOwner() {
  const app = await makeApp();
  const owner = await registerUser(app);
  await setWorkspaceRole(owner.id, "owner");
  return { app, owner };
}

/** Runs every billing Job the Worker would, until none is due. */
async function runBillingJobs(provider = new FakeBillingProvider()): Promise<void> {
  const { db } = await import("../../server/db");
  const { createJobsPort } = await import("../../server/jobs");
  const { createJobRunner } = await import("../../server/worker");
  const billing = await import("../../server/modules/billing");
  const runner = createJobRunner({
    role: "worker",
    jobs: createJobsPort({
      db,
      types: {
        [billing.BILLING_EMAIL_JOB]: billing.BILLING_EMAIL_JOB_TYPE,
        [billing.BILLING_EXPIRE_TRIAL_JOB]: billing.BILLING_EXPIRE_TRIAL_JOB_TYPE,
        [billing.BILLING_PROJECT_JOB]: billing.BILLING_PROJECT_JOB_TYPE,
      },
    }),
    handlers: {
      [billing.BILLING_EMAIL_JOB]: billing.handleBillingEmailJob,
      [billing.BILLING_EXPIRE_TRIAL_JOB]: billing.handleExpireTrialJob,
      [billing.BILLING_PROJECT_JOB]: (job) => billing.handleProjectBillingJob(job, provider),
    },
    claimerId: "back-office-test",
  });
  while (await runner.runOne()) {
    // drain
  }
}

async function tickTrialScheduler(): Promise<void> {
  const { db } = await import("../../server/db");
  const { createJobsPort } = await import("../../server/jobs");
  const { createTrialLifecycleScheduler } = await import("../../server/scheduler");
  const { BILLING_EXPIRE_TRIAL_JOB, BILLING_EXPIRE_TRIAL_JOB_TYPE } = await import(
    "../../server/modules/billing"
  );
  const jobs = createJobsPort({
    db,
    types: { [BILLING_EXPIRE_TRIAL_JOB]: BILLING_EXPIRE_TRIAL_JOB_TYPE },
  });
  await createTrialLifecycleScheduler({ role: "worker", jobs, holderId: "back-office-test" }).tick();
}

async function deliverWebhook(
  provider: FakeBillingProvider,
  event: { providerEventId: string; type: string; objectId: string; providerSubscriptionId?: string },
) {
  const { createBillingJobsPort, ingestBillingWebhook } = await import("../../server/modules/billing");
  const result = await ingestBillingWebhook({
    provider,
    jobs: createBillingJobsPort(),
    payload: JSON.stringify(event),
    signature: "signed",
  });
  await runBillingJobs(provider);
  return result;
}

const dispute = (overrides: Record<string, unknown> = {}) => ({
  providerDisputeId: "dp_1",
  providerChargeId: "ch_1",
  providerCustomerId: "cus_back_office",
  amountMinor: 3000,
  currency: "usd",
  reason: "fraudulent",
  status: "needs_response",
  openedAt: new Date("2026-10-01T10:00:00.000Z"),
  ...overrides,
});

/** Every `/api/platform/*` route the contract lists. `POST /api/support-requests` is the customer side. */
const PLATFORM_ROUTES: Array<[method: "get" | "post" | "patch", path: string]> = [
  ["get", "/api/platform/workspaces"],
  ["get", "/api/platform/workspaces/seeded"],
  ["post", "/api/platform/workspaces/seeded/trial-extension"],
  ["post", "/api/platform/workspaces/seeded/offered-plan"],
  ["post", "/api/platform/workspaces/seeded/cancel-at-period-end"],
  ["get", "/api/platform/users/someone/workspaces"],
  ["get", "/api/platform/subscriptions"],
  ["get", "/api/platform/disputes"],
  ["get", "/api/platform/support-requests"],
  ["get", "/api/platform/support-requests/anything"],
  ["patch", "/api/platform/support-requests/anything"],
  ["post", "/api/platform/support-requests/anything/answers"],
  ["post", "/api/platform/support-requests/anything/notes"],
  ["get", "/api/platform/stats"],
  ["get", "/api/platform/staff"],
  ["get", "/api/platform/support-access"],
  ["get", "/api/platform/audit-events"],
];

describe("back office access", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("refuses a customer Owner, Administrator and Member every platform route", async () => {
    const app = await makeApp();
    for (const slug of ["owner", "administrator", "member"] as const) {
      const customer = await registerUser(app);
      await setWorkspaceRole(customer.id, slug);
      for (const [method, path] of PLATFORM_ROUTES) {
        const res = await customer.agent[method](path).send({});
        expect(res.status, `${slug} ${method.toUpperCase()} ${path}`).toBe(403);
        expect(res.body).toEqual({ message: "Access denied" });
      }
    }
  });

  it("refuses Platform Staff without a second factor every platform route", async () => {
    const app = await makeApp();
    const staff = await registerPlatformStaff(app, { secondFactor: false });
    for (const [method, path] of PLATFORM_ROUTES) {
      const res = await staff.agent[method](path).send({});
      expect(res.status, `${method.toUpperCase()} ${path}`).toBe(401);
      expect(res.body).toEqual({ message: "A second factor is required", code: "setup-mfa" });
    }
  });
});

describe("back office registers", () => {
  beforeEach(async () => {
    await resetDb();
    resetEmails();
  });

  it("lists Workspaces with owner, Plan, status and seats, and the detail adds the Stripe links", async () => {
    const { app, owner } = await seededOwner();
    const staff = await registerPlatformStaff(app);
    await payingSubscription({ unitAmountMinor: 1200, currency: "usd" });

    const list = await staff.agent.get("/api/platform/workspaces");
    expect(list.status).toBe(200);
    const seeded = list.body.find((row: { id: string }) => row.id === SEEDED);
    expect(seeded).toMatchObject({
      id: SEEDED,
      name: "DocuFlow",
      owner: { userId: owner.id, email: owner.email },
      planKey: "growth",
      planLabel: "Growth",
      billingState: "Active",
      status: "active",
      billingInterval: "monthly",
      seatsUsed: 2,
      seatsPurchased: 3,
      memberCount: 2,
      cancelAtPeriodEnd: false,
      hasPaidSubscription: true,
    });

    const detail = await staff.agent.get(`/api/platform/workspaces/${SEEDED}`);
    expect(detail.status).toBe(200);
    expect(detail.body.subscription).toMatchObject({
      unitAmountMinor: 1200,
      currency: "usd",
      stripeCustomerUrl: "https://dashboard.stripe.com/test/customers/cus_back_office",
      stripeSubscriptionUrl: "https://dashboard.stripe.com/test/subscriptions/sub_back_office",
      canExtendTrial: false,
      canOfferPlan: false,
      canCancel: true,
      canUndoCancel: false,
    });
    expect(detail.body.members.map((member: { email: string }) => member.email)).toContain(owner.email);
    expect(detail.body.offerablePlans.map((plan: { planKey: string }) => plan.planKey)).toEqual([
      "starter",
      "growth",
      "business",
      "enterprise",
    ]);

    const subscriptions = await staff.agent.get("/api/platform/subscriptions");
    expect(subscriptions.body.map((row: { id: string }) => row.id)).toEqual([SEEDED]);

    const missing = await staff.agent.get("/api/platform/workspaces/nowhere");
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ message: "Workspace was not found" });
  });

  it("maps a pin to its back-office status", async () => {
    const { app } = await seededOwner();
    const staff = await registerPlatformStaff(app);
    const statusOf = async () =>
      (await staff.agent.get("/api/platform/workspaces")).body.find((row: { id: string }) => row.id === SEEDED)
        .status as string;

    await trialing(new Date(Date.now() + DAY_MS));
    expect(await statusOf()).toBe("trial");
    await trialing(new Date(Date.now() + DAY_MS), "growth");
    expect(await statusOf()).toBe("offered");
    await payingSubscription({ billingState: "PastDue" });
    expect(await statusOf()).toBe("past_due");
    await patchPin({ billingState: "ReadOnly" });
    expect(await statusOf()).toBe("cancelled");
    await patchPin({ stripeSubscriptionId: null });
    expect(await statusOf()).toBe("read_only");
  });

  it("lists the Workspaces a User belongs to", async () => {
    const { app, owner } = await seededOwner();
    const staff = await registerPlatformStaff(app);
    const res = await staff.agent.get(`/api/platform/users/${owner.id}/workspaces`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { workspaceId: SEEDED, workspaceName: "DocuFlow", workspaceRole: "owner", archived: false },
    ]);
  });

  it("lists the signed-in staff member's active Support Access Grants across Workspaces", async () => {
    const { app, owner } = await seededOwner();
    const staff = await registerPlatformStaff(app);
    const other = await registerPlatformStaff(app);

    expect((await staff.agent.get("/api/platform/support-access")).body).toEqual([]);
    const created = await owner.agent.post("/api/admin/support-access-grants").send({ platformStaffId: staff.staffId });
    expect(created.status).toBe(201);
    await owner.agent.post("/api/admin/support-access-grants").send({ platformStaffId: other.staffId });

    const res = await staff.agent.get("/api/platform/support-access");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ grantId: created.body.id, workspaceId: SEEDED, workspaceName: "DocuFlow" });
    expect(new Date(res.body[0].expiresAt).getTime()).toBeGreaterThan(Date.now());

    const directory = await staff.agent.get("/api/platform/staff");
    expect(directory.body.map((row: { id: string }) => row.id).sort()).toEqual([staff.staffId, other.staffId].sort());
  });
});

describe("back office billing actions", () => {
  beforeEach(async () => {
    await resetDb();
    resetEmails();
  });

  it("extends a Trial, changes the pin and writes exactly one Audit Event", async () => {
    const { app } = await seededOwner();
    const staff = await registerPlatformStaff(app);
    const endsAt = new Date(Date.now() + 2 * DAY_MS);
    await trialing(endsAt);
    const before = await auditCount();
    const versionBefore = (await pinOf()).authorizationVersion;

    const res = await staff.agent.post(`/api/platform/workspaces/${SEEDED}/trial-extension`).send({ days: 7 });
    expect(res.status).toBe(200);
    expect(new Date(res.body.trialEndsAt).getTime()).toBe(endsAt.getTime() + 7 * DAY_MS);
    expect(res.body.status).toBe("trial");

    expect((await pinOf()).authorizationVersion).toBe(versionBefore + 1);
    expect(await auditCount()).toBe(before + 1);
    const [event] = await auditActions();
    expect(event).toMatchObject({
      action: "billing.trial_extended",
      actorKind: "platform_staff",
      actorId: staff.staffId,
      payload: { from: endsAt.toISOString(), to: new Date(endsAt.getTime() + 7 * DAY_MS).toISOString(), days: 7 },
    });

    const refused = await staff.agent.post(`/api/platform/workspaces/${SEEDED}/trial-extension`).send({ days: 0 });
    expect(refused.status).toBe(400);
  });

  it("refuses to extend a Workspace that is not Trialing", async () => {
    const { app } = await seededOwner();
    const staff = await registerPlatformStaff(app);
    const before = await auditCount();
    const res = await staff.agent.post(`/api/platform/workspaces/${SEEDED}/trial-extension`).send({ days: 7 });
    expect(res.status).toBe(409);
    expect(await auditCount()).toBe(before);
  });

  it("offers a Plan to a read-only Workspace: Trialing on that Plan, one Audit Event", async () => {
    const { app } = await seededOwner();
    const staff = await registerPlatformStaff(app);
    await patchPin({
      planKey: "trial",
      registryVersion: 2,
      billingState: "ReadOnly",
      purchasedSeatCapacity: 3,
      stripeSubscriptionId: "sub_ended",
      stripeCustomerId: "cus_back_office",
      cancelAtPeriodEnd: true,
      periodEndsAt: new Date(Date.now() - DAY_MS),
      unitAmountMinor: 900,
      currency: "usd",
    });
    const before = await auditCount();

    const res = await staff.agent
      .post(`/api/platform/workspaces/${SEEDED}/offered-plan`)
      .send({ planKey: "growth", days: 10, seats: 5 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ planKey: "growth", billingState: "Trialing", status: "offered", seatsPurchased: 5 });

    const pin = await pinOf();
    expect(pin).toMatchObject({
      planKey: "growth",
      registryVersion: 2,
      billingState: "Trialing",
      purchasedSeatCapacity: 5,
      cancelAtPeriodEnd: false,
      periodEndsAt: null,
      stripeSubscriptionId: null,
      stripeCustomerId: "cus_back_office",
      unitAmountMinor: null,
      currency: null,
    });
    expect(Math.abs(pin.trialEndsAt!.getTime() - (Date.now() + 10 * DAY_MS))).toBeLessThan(60_000);

    expect(await auditCount()).toBe(before + 1);
    const [event] = await auditActions();
    expect(event).toMatchObject({
      action: "billing.plan_offered",
      actorKind: "platform_staff",
      actorId: staff.staffId,
      payload: { from: "ReadOnly", to: "Trialing", planKey: "growth", days: 10, seats: 5 },
    });

    const outbox = await entitlementsChangedEvents();
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({
      version: 1,
      actorKind: "platform_staff",
      actorId: staff.staffId,
      aggregateType: "workspace_billing",
      aggregateId: SEEDED,
      payload: { authorizationVersion: pin.authorizationVersion },
    });
  });

  it("offers a Plan only to a Workspace without a paid Subscription", async () => {
    const { app } = await seededOwner();
    const staff = await registerPlatformStaff(app);
    const offer = () =>
      staff.agent.post(`/api/platform/workspaces/${SEEDED}/offered-plan`).send({ planKey: "business", days: 14 });

    await payingSubscription();
    const before = await auditCount();
    const paid = await offer();
    expect(paid.status).toBe(409);
    expect(paid.body).toEqual({ message: "Only a Workspace without a paid Subscription can be offered a Plan" });

    // A sales-led or legacy Workspace is Active without a Subscription and is refused as well.
    await patchPin({ planKey: "legacy", registryVersion: 1, stripeSubscriptionId: null });
    expect((await offer()).status).toBe(409);
    expect(await auditCount()).toBe(before);

    await trialing(new Date(Date.now() + DAY_MS));
    const trial = await offer();
    expect(trial.status).toBe(200);
    expect(trial.body.planKey).toBe("business");

    const unknown = await staff.agent
      .post(`/api/platform/workspaces/${SEEDED}/offered-plan`)
      .send({ planKey: "trial", days: 14 });
    expect(unknown.status).toBe(400);
  });

  it("ends an Offered Plan like a Trial: a warning three days before, then read-only", async () => {
    const { app, owner } = await seededOwner();
    const staff = await registerPlatformStaff(app);
    await trialing(new Date(Date.now() + DAY_MS));
    const offered = await staff.agent
      .post(`/api/platform/workspaces/${SEEDED}/offered-plan`)
      .send({ planKey: "growth", days: 30 });
    expect(offered.status).toBe(200);
    resetEmails();

    await patchPin({ trialEndsAt: new Date(Date.now() + 2 * DAY_MS) });
    await tickTrialScheduler();
    await runBillingJobs();
    expect(emailsTo(owner.email).map((mail) => mail.subject)).toEqual([
      "DocuFlow — Your Trial of DocuFlow ends in 3 days",
    ]);
    expect((await pinOf()).billingState).toBe("Trialing");

    await patchPin({ trialEndsAt: new Date(Date.now() - 60_000) });
    await tickTrialScheduler();
    await runBillingJobs();

    expect((await pinOf()).billingState).toBe("ReadOnly");
    const transition = (await auditActions()).find((event) => event.action === "billing.state_transition");
    expect(transition?.payload).toMatchObject({ from: "Trialing", to: "ReadOnly", reason: "offer_expired" });
    const ended = emailsTo(owner.email).at(-1);
    expect(ended?.subject).toBe("DocuFlow — DocuFlow is now read-only");
    expect(ended?.html).toContain("The Plan offered to <strong>DocuFlow</strong> has ended");
    const list = await staff.agent.get("/api/platform/workspaces");
    expect(list.body.find((row: { id: string }) => row.id === SEEDED).status).toBe("read_only");
  });

  it("flags a paid Subscription to end at its period end, and undoes it, through Stripe", async () => {
    const { app } = await seededOwner();
    const staff = await registerPlatformStaff(app);
    await payingSubscription();
    const before = await auditCount();
    const calls = subscriptionUpdateCalls().length;

    const cancel = await staff.agent.post(`/api/platform/workspaces/${SEEDED}/cancel-at-period-end`).send({ cancel: true });
    expect(cancel.status).toBe(200);
    expect(cancel.body.cancelAtPeriodEnd).toBe(true);
    expect(cancel.body.subscription).toMatchObject({ canCancel: false, canUndoCancel: true });
    expect((await pinOf()).cancelAtPeriodEnd).toBe(true);
    expect(await auditCount()).toBe(before + 1);
    expect(subscriptionUpdateCalls().slice(calls)).toEqual([
      { id: "sub_back_office", cancel_at_period_end: true },
    ]);
    const [flagged] = await auditActions();
    expect(flagged).toMatchObject({
      action: "billing.cancel_at_period_end",
      actorKind: "platform_staff",
      actorId: staff.staffId,
    });

    const twice = await staff.agent.post(`/api/platform/workspaces/${SEEDED}/cancel-at-period-end`).send({ cancel: true });
    expect(twice.status).toBe(409);
    expect(await auditCount()).toBe(before + 1);

    const undo = await staff.agent.post(`/api/platform/workspaces/${SEEDED}/cancel-at-period-end`).send({ cancel: false });
    expect(undo.status).toBe(200);
    expect(undo.body.cancelAtPeriodEnd).toBe(false);
    expect((await pinOf()).cancelAtPeriodEnd).toBe(false);
    expect(await auditCount()).toBe(before + 2);
    expect(subscriptionUpdateCalls().slice(calls).at(-1)).toEqual({
      id: "sub_back_office",
      cancel_at_period_end: false,
    });
    expect((await auditActions())[0].action).toBe("billing.cancel_at_period_end_undone");
  });

  it("refuses to cancel a Workspace that has no paid Subscription", async () => {
    const { app } = await seededOwner();
    const staff = await registerPlatformStaff(app);
    const before = await auditCount();
    const res = await staff.agent.post(`/api/platform/workspaces/${SEEDED}/cancel-at-period-end`).send({ cancel: true });
    expect(res.status).toBe(409);
    expect(await auditCount()).toBe(before);
  });

  it("lists staff actions in the Audit Log without their payload, and filters them", async () => {
    const { app } = await seededOwner();
    const staff = await registerPlatformStaff(app);
    await trialing(new Date(Date.now() + DAY_MS));
    await staff.agent.post(`/api/platform/workspaces/${SEEDED}/trial-extension`).send({ days: 3 });
    await staff.agent
      .post(`/api/platform/workspaces/${SEEDED}/offered-plan`)
      .send({ planKey: "starter", days: 5 });

    const all = await staff.agent.get("/api/platform/audit-events");
    expect(all.status).toBe(200);
    expect(all.body.map((row: { action: string }) => row.action)).toEqual([
      "billing.plan_offered",
      "billing.trial_extended",
    ]);
    expect(all.body[0]).toMatchObject({
      workspaceId: SEEDED,
      workspaceName: "DocuFlow",
      actorKind: "platform_staff",
      actorId: staff.staffId,
      actorLabel: staff.email,
    });
    expect(all.body[0]).not.toHaveProperty("payload");

    const byAction = await staff.agent.get("/api/platform/audit-events").query({ action: "billing.trial_extended" });
    expect(byAction.body).toHaveLength(1);
    const byStaff = await staff.agent.get("/api/platform/audit-events").query({ platformStaffId: "someone-else" });
    expect(byStaff.body).toEqual([]);
    const byWorkspace = await staff.agent.get("/api/platform/audit-events").query({ workspaceId: SEEDED });
    expect(byWorkspace.body).toHaveLength(2);
  });
});

describe("payments and disputes", () => {
  beforeEach(async () => {
    await resetDb();
    resetEmails();
  });

  it("records a dispute from its webhook and shows it on the register and the Workspace page", async () => {
    const { app } = await seededOwner();
    const staff = await registerPlatformStaff(app);
    await payingSubscription();
    const provider = new FakeBillingProvider();
    provider.disputes.set("dp_1", dispute());

    const result = await deliverWebhook(provider, {
      providerEventId: "evt_dp_1",
      type: "charge.dispute.created",
      objectId: "dp_1",
    });
    expect(result).toEqual({ accepted: true, duplicate: false, enqueued: false });

    const list = await staff.agent.get("/api/platform/disputes");
    expect(list.status).toBe(200);
    expect(list.body).toEqual([
      {
        id: "dp_1",
        workspaceId: SEEDED,
        workspaceName: "DocuFlow",
        amountMinor: 3000,
        currency: "usd",
        reason: "fraudulent",
        status: "needs_response",
        open: true,
        openedAt: "2026-10-01T10:00:00.000Z",
        stripeUrl: "https://dashboard.stripe.com/test/disputes/dp_1",
      },
    ]);
    const detail = await staff.agent.get(`/api/platform/workspaces/${SEEDED}`);
    expect(detail.body.disputes).toHaveLength(1);

    // Stripe's latest status wins, and a repeated event changes nothing.
    provider.disputes.set("dp_1", dispute({ status: "won" }));
    await deliverWebhook(provider, { providerEventId: "evt_dp_2", type: "charge.dispute.closed", objectId: "dp_1" });
    const repeat = await deliverWebhook(provider, {
      providerEventId: "evt_dp_2",
      type: "charge.dispute.closed",
      objectId: "dp_1",
    });
    expect(repeat.duplicate).toBe(true);
    const closed = await staff.agent.get("/api/platform/disputes");
    expect(closed.body).toHaveLength(1);
    expect(closed.body[0]).toMatchObject({ status: "won", open: false });
  });

  it("accepts a dispute of an unknown customer without recording it, and still refuses unknown events", async () => {
    const { app } = await seededOwner();
    const staff = await registerPlatformStaff(app);
    await payingSubscription();
    const provider = new FakeBillingProvider();
    provider.disputes.set("dp_x", dispute({ providerDisputeId: "dp_x", providerCustomerId: "cus_stranger" }));

    const result = await deliverWebhook(provider, {
      providerEventId: "evt_dp_x",
      type: "charge.dispute.created",
      objectId: "dp_x",
    });
    expect(result).toEqual({ accepted: true, duplicate: false, enqueued: false });
    expect((await staff.agent.get("/api/platform/disputes")).body).toEqual([]);

    const { createBillingJobsPort, ingestBillingWebhook, UnknownBillingWebhookError } = await import(
      "../../server/modules/billing"
    );
    await expect(
      ingestBillingWebhook({
        provider,
        jobs: createBillingJobsPort(),
        payload: JSON.stringify({ providerEventId: "evt_other", type: "customer.created", objectId: "cus_1" }),
        signature: "signed",
      }),
    ).rejects.toBeInstanceOf(UnknownBillingWebhookError);
  });

  it("records invoice.paid and invoice.payment_failed, and the failed notice still goes out", async () => {
    const { app, owner } = await seededOwner();
    const staff = await registerPlatformStaff(app);
    await payingSubscription();
    const provider = new FakeBillingProvider();
    provider.invoices.set("in_paid", { paid: true, nextPaymentAttemptAt: null, amountMinor: 3600, currency: "usd" });
    provider.invoices.set("in_failed", {
      paid: false,
      nextPaymentAttemptAt: new Date(Date.now() + 3 * DAY_MS),
      amountMinor: 3600,
      currency: "usd",
    });

    await deliverWebhook(provider, {
      providerEventId: "evt_paid",
      type: "invoice.paid",
      objectId: "in_paid",
      providerSubscriptionId: "sub_back_office",
    });
    await deliverWebhook(provider, {
      providerEventId: "evt_failed",
      type: "invoice.payment_failed",
      objectId: "in_failed",
      providerSubscriptionId: "sub_back_office",
    });
    // At-least-once delivery: the same event again records nothing new.
    await deliverWebhook(provider, {
      providerEventId: "evt_failed",
      type: "invoice.payment_failed",
      objectId: "in_failed",
      providerSubscriptionId: "sub_back_office",
    });

    const detail = await staff.agent.get(`/api/platform/workspaces/${SEEDED}`);
    expect(detail.body.payments.map((payment: { outcome: string }) => payment.outcome).sort()).toEqual([
      "failed",
      "paid",
    ]);
    const failed = detail.body.payments.find((payment: { outcome: string }) => payment.outcome === "failed");
    expect(failed).toMatchObject({
      providerInvoiceId: "in_failed",
      amountMinor: 3600,
      currency: "usd",
      stripeUrl: "https://dashboard.stripe.com/test/invoices/in_failed",
    });
    expect(emailsTo(owner.email).map((mail) => mail.subject)).toEqual([
      "DocuFlow — Payment failed for DocuFlow",
    ]);
    // Neither event changed the billing state.
    expect((await pinOf()).billingState).toBe("Active");
  });
});

describe("Support Requests", () => {
  beforeEach(async () => {
    await resetDb();
    resetEmails();
  });

  async function sendRequest() {
    const app = await makeApp();
    const member = await registerUser(app, { firstName: "Mia", lastName: "Member" });
    const staff = await registerPlatformStaff(app);
    const sent = await member.agent
      .post("/api/support-requests")
      .send({ category: "billing", message: "  Our invoice is wrong  " });
    return { app, member, staff, sent };
  }

  it("reaches the back office with its Workspace and User, and is audited without its message", async () => {
    const { member, staff, sent } = await sendRequest();
    expect(sent.status).toBe(201);
    expect(sent.body).toEqual({ id: expect.any(String), status: "open" });

    const list = await staff.agent.get("/api/platform/support-requests");
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({
      id: sent.body.id,
      workspaceId: SEEDED,
      workspaceName: "DocuFlow",
      user: { userId: member.id, name: "Mia Member", email: member.email },
      category: "billing",
      message: "Our invoice is wrong",
      status: "open",
      assignedStaff: null,
    });

    const detail = await staff.agent.get(`/api/platform/support-requests/${sent.body.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.entries).toEqual([]);

    const [created] = await auditActions();
    expect(created).toMatchObject({
      action: "support_request.created",
      actorKind: "user",
      actorId: member.id,
      payload: { category: "billing" },
    });

    expect((await staff.agent.get("/api/platform/support-requests/nope")).status).toBe(404);
  });

  it("validates the request, and lets a read-only Workspace still ask for help", async () => {
    const { member } = await sendRequest();
    const bad = await member.agent.post("/api/support-requests").send({ category: "other", message: "   " });
    expect(bad.status).toBe(400);
    const badCategory = await member.agent.post("/api/support-requests").send({ category: "feedback", message: "hi" });
    expect(badCategory.status).toBe(400);

    await patchPin({ billingState: "ReadOnly" });
    const readOnly = await member.agent.post("/api/support-requests").send({ category: "billing", message: "Help" });
    expect(readOnly.status).toBe(201);
  });

  it("emails an answer to the User and keeps it on the request", async () => {
    const { member, staff, sent } = await sendRequest();
    resetEmails();
    const before = await auditCount();

    const answered = await staff.agent
      .post(`/api/platform/support-requests/${sent.body.id}/answers`)
      .send({ body: "We corrected <b>the invoice</b>." });
    expect(answered.status).toBe(201);
    expect(answered.body.status).toBe("open");

    const mail = emailsTo(member.email);
    expect(mail).toHaveLength(1);
    expect(mail[0].subject).toBe("DocuFlow — An answer to your Support Request");
    expect(mail[0].html).toContain("We corrected &lt;b&gt;the invoice&lt;/b&gt;.");

    const detail = await staff.agent.get(`/api/platform/support-requests/${sent.body.id}`);
    expect(detail.body.entries).toHaveLength(1);
    expect(detail.body.entries[0]).toMatchObject({
      kind: "answer",
      body: "We corrected <b>the invoice</b>.",
      staff: { id: staff.staffId, email: staff.email },
    });
    expect(detail.body.entries[0].emailedAt).not.toBeNull();

    expect(await auditCount()).toBe(before + 1);
    const [event] = await auditActions();
    expect(event.action).toBe("support_request.answered");
    expect(event.actorKind).toBe("platform_staff");
    expect(JSON.stringify(event.payload)).not.toContain("corrected");
  });

  it("keeps nothing when the answer cannot be emailed", async () => {
    const { staff, sent } = await sendRequest();
    const before = await auditCount();
    failNextSend();

    const res = await staff.agent
      .post(`/api/platform/support-requests/${sent.body.id}/answers`)
      .send({ body: "This will not arrive" });
    expect(res.status).toBe(502);

    const detail = await staff.agent.get(`/api/platform/support-requests/${sent.body.id}`);
    expect(detail.body.entries).toEqual([]);
    expect(await auditCount()).toBe(before);
  });

  it("keeps an internal note without emailing anyone", async () => {
    const { member, staff, sent } = await sendRequest();
    resetEmails();
    const note = await staff.agent
      .post(`/api/platform/support-requests/${sent.body.id}/notes`)
      .send({ body: "Looks like a duplicate charge" });
    expect(note.status).toBe(201);
    expect(note.body.entries).toHaveLength(1);
    expect(note.body.entries[0]).toMatchObject({ kind: "note", emailedAt: null });
    expect(emailsTo(member.email)).toEqual([]);
    expect((await auditActions())[0]).toMatchObject({ action: "support_request.noted", actorId: staff.staffId });

    const empty = await staff.agent.post(`/api/platform/support-requests/${sent.body.id}/notes`).send({ body: "" });
    expect(empty.status).toBe(400);
  });

  it("tells the User when the status changes, and audits status and assignment separately", async () => {
    const { member, staff, sent } = await sendRequest();
    resetEmails();
    const before = await auditCount();

    const res = await staff.agent
      .patch(`/api/platform/support-requests/${sent.body.id}`)
      .send({ status: "in_progress", assignedStaffId: staff.staffId });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: "in_progress",
      assignedStaff: { id: staff.staffId, email: staff.email },
    });
    expect(await auditCount()).toBe(before + 2);
    const actions = (await auditActions()).slice(0, 2);
    expect(actions.map((event) => event.action).sort()).toEqual([
      "support_request.assigned",
      "support_request.status_changed",
    ]);
    const changed = actions.find((event) => event.action === "support_request.status_changed");
    expect(changed?.payload).toEqual({ from: "open", to: "in_progress" });

    const { db } = await import("../../server/db");
    const notices = await inSeededWorkspace(() =>
      db
        .select({ userId: notifications.userId, message: notifications.message })
        .from(notifications)
        .where(eq(notifications.type, "support_request_status")),
    );
    expect(notices).toEqual([{ userId: member.id, message: "Your Support Request is now in progress." }]);
    const mail = emailsTo(member.email);
    expect(mail).toHaveLength(1);
    expect(mail[0].subject).toBe("DocuFlow — Your Support Request is now in progress");
    expect(mail[0].html).not.toContain("Our invoice is wrong");

    // Nothing changed, so nothing is audited or sent.
    const same = await staff.agent
      .patch(`/api/platform/support-requests/${sent.body.id}`)
      .send({ status: "in_progress" });
    expect(same.status).toBe(200);
    expect(await auditCount()).toBe(before + 2);
    expect(emailsTo(member.email)).toHaveLength(1);

    const unassigned = await staff.agent
      .patch(`/api/platform/support-requests/${sent.body.id}`)
      .send({ assignedStaffId: null });
    expect(unassigned.body.assignedStaff).toBeNull();

    expect((await staff.agent.patch(`/api/platform/support-requests/${sent.body.id}`).send({})).status).toBe(400);
    expect(
      (await staff.agent.patch(`/api/platform/support-requests/${sent.body.id}`).send({ status: "closed" })).status,
    ).toBe(400);
    expect(
      (await staff.agent.patch(`/api/platform/support-requests/nope`).send({ status: "resolved" })).status,
    ).toBe(404);
    expect(
      (
        await staff.agent
          .patch(`/api/platform/support-requests/${sent.body.id}`)
          .send({ assignedStaffId: "no-such-staff" })
      ).status,
    ).toBe(404);

    const stored = await inSeededWorkspace(() =>
      db.select({ status: supportRequests.status }).from(supportRequests).where(eq(supportRequests.id, sent.body.id)),
    );
    expect(stored).toEqual([{ status: "in_progress" }]);
    const entries = await inSeededWorkspace(() => db.select().from(supportRequestEntries));
    expect(entries).toEqual([]);
  });
});

describe("platform statistics", () => {
  beforeEach(async () => {
    await resetDb();
    resetEmails();
  });

  it("adds MRR per currency, never across them", async () => {
    const { app } = await seededOwner();
    const staff = await registerPlatformStaff(app);
    const parallel = await plantParallelWorkspace("Harbour View");
    await payingSubscription({ unitAmountMinor: 1000, currency: "usd", purchasedSeatCapacity: 3 });
    await patchPin(
      {
        planKey: "business",
        registryVersion: 2,
        billingState: "PastDue",
        purchasedSeatCapacity: 2,
        stripeSubscriptionId: "sub_eur",
        billingInterval: "annual",
        unitAmountMinor: 12_100,
        currency: "eur",
      },
      parallel,
    );

    const res = await staff.agent.get("/api/platform/stats");
    expect(res.status).toBe(200);
    expect(res.body.days).toBe(30);
    // usd: 1000 x 3 a month. eur: 12100 x 2 a year, a twelfth of it a month, rounded at the end.
    expect(res.body.revenue.mrr).toEqual([
      { currency: "eur", amountMinor: 2017 },
      { currency: "usd", amountMinor: 3000 },
    ]);
    expect(res.body.revenue).toMatchObject({ trialsInProgress: 0, offeredPlansInProgress: 0 });
  });

  it("counts a sign-in toward a Workspace only through an active Membership", async () => {
    const { app } = await seededOwner();
    const staff = await registerPlatformStaff(app);
    const { db } = await import("../../server/db");
    const { memberships, users } = await import("@shared/schema");
    await db.update(users).set({ lastLoginAt: new Date() });

    const active = await staff.agent.get("/api/platform/stats");
    expect(active.body.growth).toMatchObject({ activeWorkspaces7d: 1, activeWorkspaces30d: 1 });

    await db.update(memberships).set({ archivedAt: new Date() });
    const archived = await staff.agent.get("/api/platform/stats");
    expect(archived.body.growth).toMatchObject({ activeWorkspaces7d: 0, activeWorkspaces30d: 0 });
  });

  it("counts trials, offered plans, conversions, cancellations, failed payments and read-only reasons", async () => {
    const { app } = await seededOwner();
    const staff = await registerPlatformStaff(app);
    const parallel = await plantParallelWorkspace("Harbour View");
    const { db } = await import("../../server/db");
    const { runWithWorkspaceContext } = await import("../../server/workspaceContext");
    const { billingPayments } = await import("@shared/schema");

    await trialing(new Date(Date.now() + DAY_MS));
    await patchPin(
      {
        planKey: "growth",
        registryVersion: 2,
        billingState: "ReadOnly",
        purchasedSeatCapacity: 1,
        stripeSubscriptionId: "sub_gone",
      },
      parallel,
    );
    await runWithWorkspaceContext({ workspaceId: parallel }, async () => {
      await db.insert(auditEvents).values([
        {
          workspaceId: parallel,
          actorKind: "system",
          action: "billing.state_transition",
          resourceType: "workspace_billing",
          payload: { from: "Trialing", to: "Active", reason: "provider_projection" },
          createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
        },
        // A cancelled Subscription ending: the one cancellation.
        {
          workspaceId: parallel,
          actorKind: "system",
          action: "billing.state_transition",
          resourceType: "workspace_billing",
          payload: { from: "Active", to: "ReadOnly", reason: "provider_projection" },
          createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        },
        // What the projection really writes when dunning runs out: not a cancellation.
        {
          workspaceId: parallel,
          actorKind: "system",
          action: "billing.state_transition",
          resourceType: "workspace_billing",
          payload: { from: "PastDue", to: "ReadOnly", reason: "provider_projection" },
          createdAt: new Date(Date.now() - 60 * 60 * 1000),
        },
      ]);
      await db.insert(billingPayments).values([
        {
          workspaceId: parallel,
          providerEventId: "evt_a",
          providerInvoiceId: "in_a",
          outcome: "failed",
          occurredAt: new Date(),
        },
        {
          workspaceId: parallel,
          providerEventId: "evt_b",
          providerInvoiceId: "in_b",
          outcome: "paid",
          occurredAt: new Date(),
        },
        {
          workspaceId: parallel,
          providerEventId: "evt_c",
          providerInvoiceId: "in_c",
          outcome: "failed",
          occurredAt: new Date(Date.now() - 40 * DAY_MS),
        },
      ]);
    });

    const res = await staff.agent.get("/api/platform/stats").query({ days: 7 });
    expect(res.status).toBe(200);
    expect(res.body.days).toBe(7);
    expect(res.body.revenue).toMatchObject({
      trialsInProgress: 1,
      offeredPlansInProgress: 0,
      trialConversions: 1,
      cancellations: 1,
    });
    expect(res.body.payments).toMatchObject({
      failedPayments: 1,
      readOnlyByReason: [{ reason: "dunning_exhausted", count: 1 }],
      openDisputes: 0,
    });
    expect(res.body.growth.newUsers).toBeGreaterThanOrEqual(1);
    expect(res.body.growth.newWorkspaces).toBeGreaterThanOrEqual(1);

    expect((await staff.agent.get("/api/platform/stats").query({ days: 45 })).status).toBe(400);
  });
});

describe("Workspace content stays out of the back office", () => {
  beforeEach(async () => {
    await resetDb();
    resetEmails();
  });

  it("returns no Project, Document or Time Entry text from the stats or the Workspace page", async () => {
    const { app, owner } = await seededOwner();
    const staff = await registerPlatformStaff(app);
    const project = await createCrmProject(owner.agent, { name: "SECRET-project-name" });
    await createDocument(owner.agent, project.project.id, { title: "SECRET-document-title" });
    const task = await createTask(owner.agent, project.crmProject.id, "SECRET-task-name");
    await startTimer(owner.agent, project.crmProject.id, task.id, "SECRET-time-entry-note");

    const stats = await staff.agent.get("/api/platform/stats");
    const detail = await staff.agent.get(`/api/platform/workspaces/${SEEDED}`);
    const list = await staff.agent.get("/api/platform/workspaces");
    expect(stats.status).toBe(200);
    expect(detail.status).toBe(200);
    for (const body of [stats.body, detail.body, list.body]) {
      expect(JSON.stringify(body)).not.toContain("SECRET");
    }
    expect(detail.body.lastActivityAt).not.toBeNull();

    // Content is the grant or break-glass path, and only that one.
    const denied = await staff.agent.get(`/api/operator/workspaces/${SEEDED}`);
    expect(denied.status).toBe(403);
    expect(JSON.stringify(denied.body)).not.toContain("SECRET");

    const opened = await staff.agent
      .post(`/api/operator/workspaces/${SEEDED}/break-glass`)
      .send({ reason: "Customer cannot open a Project" });
    expect(opened.status).toBe(201);
    const read = await staff.agent.get(`/api/operator/workspaces/${SEEDED}`);
    expect(read.status).toBe(200);
    expect(read.body.projects).toEqual([{ id: project.project.id, name: "SECRET-project-name" }]);
  });

  it("lists Audit Events without payload even when one carries a reason", async () => {
    const { app } = await seededOwner();
    const staff = await registerPlatformStaff(app);
    await staff.agent
      .post(`/api/operator/workspaces/${SEEDED}/break-glass`)
      .send({ reason: "SECRET-reason-text" });
    const log = await staff.agent.get("/api/platform/audit-events");
    expect(log.body.map((row: { action: string }) => row.action)).toContain("support_access.break_glass");
    expect(JSON.stringify(log.body)).not.toContain("SECRET");
    const detail = await staff.agent.get(`/api/platform/workspaces/${SEEDED}`);
    expect(JSON.stringify(detail.body)).not.toContain("SECRET");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { workspaces, workspaceRoles } from "../../shared/schema";
import { FakeBillingProvider } from "../fakes/billingProvider";
import { resetDb } from "../helpers/db";

/**
 * Phase 8 ticket #143: project Stripe into Entitlements through the outbox.
 * Seams: BillingProvider fake (signature), webhook inbox (dedupe), projection
 * Job (apply), drift Job (alert, no clobber). HTTP does not apply Entitlements.
 * Characterization stays green.
 */

const PAID_WORKSPACE_ID = "paid";
const SUBSCRIPTION_ID = "sub_fake_1";
const PERIOD_END = new Date("2026-10-01T00:00:00.000Z");
const SIGNED_EVENT = {
  providerEventId: "evt_fake_1",
  type: "customer.subscription.updated",
  objectId: SUBSCRIPTION_ID,
};
const PROVIDER_SUB = {
  providerCustomerId: "cus_fake_1",
  providerSubscriptionId: SUBSCRIPTION_ID,
  planKey: "pro" as const,
  seatQuantity: 3,
  currentPeriodEnd: PERIOD_END,
  cancelAtPeriodEnd: false,
  collectionState: "Current" as const,
};

async function plantPaidWorkspace() {
  const { db } = await import("../../server/db");
  const { workspaceBilling } = await import("../../shared/schema");
  await db.insert(workspaces).values({ id: PAID_WORKSPACE_ID, name: "Paid" });
  await db.insert(workspaceRoles).values({
    id: `${PAID_WORKSPACE_ID}-owner`,
    workspaceId: PAID_WORKSPACE_ID,
    slug: "owner",
    name: "Owner",
  });
  await db.insert(workspaceBilling).values({
    workspaceId: PAID_WORKSPACE_ID,
    planKey: "trial",
    registryVersion: 1,
    billingState: "Trialing",
    purchasedSeatCapacity: 1,
    authorizationVersion: 1,
    stripeCustomerId: "cus_fake_1",
    stripeSubscriptionId: SUBSCRIPTION_ID,
    trialEndsAt: new Date("2026-01-15T00:00:00.000Z"),
  });
}

function signedPayload(event = SIGNED_EVENT) {
  return JSON.stringify(event);
}

async function billingJobs() {
  const { db } = await import("../../server/db");
  const { createJobsPort } = await import("../../server/jobs");
  const {
    BILLING_PROJECT_JOB,
    BILLING_PROJECT_JOB_TYPE,
    BILLING_DRIFT_JOB,
    BILLING_DRIFT_JOB_TYPE,
  } = await import("../../server/modules/billing");
  return createJobsPort({
    db,
    types: {
      [BILLING_PROJECT_JOB]: BILLING_PROJECT_JOB_TYPE,
      [BILLING_DRIFT_JOB]: BILLING_DRIFT_JOB_TYPE,
    },
  });
}

describe("signed webhook ingest", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("accepts a signed webhook into the inbox and rejects unsigned or unknown ones", async () => {
    const { ingestBillingWebhook, BillingWebhookSignatureError, UnknownBillingWebhookError } =
      await import("../../server/modules/billing");
    const provider = new FakeBillingProvider();
    const jobs = await billingJobs();
    await plantPaidWorkspace();

    const accepted = await ingestBillingWebhook({
      provider,
      jobs,
      payload: signedPayload(),
      signature: "signed",
    });
    expect(accepted).toMatchObject({ accepted: true, duplicate: false });

    await expect(
      ingestBillingWebhook({
        provider,
        jobs,
        payload: signedPayload(),
        signature: "unsigned",
      })
    ).rejects.toBeInstanceOf(BillingWebhookSignatureError);

    await expect(
      ingestBillingWebhook({
        provider,
        jobs,
        payload: signedPayload({ ...SIGNED_EVENT, type: "invoice.created" }),
        signature: "signed",
      })
    ).rejects.toBeInstanceOf(UnknownBillingWebhookError);
  });

  it("returns from HTTP ingest without applying Entitlements", async () => {
    const { ingestBillingWebhook, getBillingProjection, effectiveEntitlements } = await import(
      "../../server/modules/billing"
    );
    const { runWithWorkspaceContext } = await import("../../server/workspaceContext");
    const provider = new FakeBillingProvider();
    provider.subscriptions.set(SUBSCRIPTION_ID, PROVIDER_SUB);
    const jobs = await billingJobs();
    await plantPaidWorkspace();

    await ingestBillingWebhook({
      provider,
      jobs,
      payload: signedPayload(),
      signature: "signed",
    });

    const pin = await runWithWorkspaceContext({ workspaceId: PAID_WORKSPACE_ID }, () =>
      getBillingProjection()
    );
    expect(pin).toMatchObject({
      billingState: "Trialing",
      planKey: "trial",
      purchasedSeatCapacity: 1,
      authorizationVersion: 1,
    });
    await expect(
      runWithWorkspaceContext({ workspaceId: PAID_WORKSPACE_ID }, () => effectiveEntitlements())
    ).resolves.toMatchObject({ writesAllowed: true, seatCapacity: 1 });
    expect(provider.fetches).toEqual([]);
  });
});

describe("projection Job", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("applies a provider-neutral projection, Entitlements, authorization version, and Outbox Event", async () => {
    const {
      ingestBillingWebhook,
      getBillingProjection,
      effectiveEntitlements,
      handleProjectBillingJob,
      BILLING_PROJECT_JOB,
    } = await import("../../server/modules/billing");
    const { runWithWorkspaceContext } = await import("../../server/workspaceContext");
    const { createJobRunner } = await import("../../server/worker");
    const { db } = await import("../../server/db");
    const { outboxEvents, auditEvents, jobs } = await import("../../shared/schema");

    const provider = new FakeBillingProvider();
    provider.subscriptions.set(SUBSCRIPTION_ID, PROVIDER_SUB);
    const jobsPort = await billingJobs();
    await plantPaidWorkspace();

    await ingestBillingWebhook({
      provider,
      jobs: jobsPort,
      payload: signedPayload(),
      signature: "signed",
    });

    const queued = await db.select().from(jobs);
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      type: BILLING_PROJECT_JOB,
      workspaceId: PAID_WORKSPACE_ID,
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
    expect(await worker.runOne()).toBeNull();

    const pin = await runWithWorkspaceContext({ workspaceId: PAID_WORKSPACE_ID }, () =>
      getBillingProjection()
    );
    expect(pin).toMatchObject({
      workspaceId: PAID_WORKSPACE_ID,
      planKey: "pro",
      registryVersion: 1,
      billingState: "Active",
      purchasedSeatCapacity: 3,
      authorizationVersion: 2,
      stripeCustomerId: "cus_fake_1",
      stripeSubscriptionId: SUBSCRIPTION_ID,
      cancelAtPeriodEnd: false,
    });
    expect(pin.periodEndsAt).toEqual(PERIOD_END);
    expect(pin.billingState).not.toBe("Current");

    await expect(
      runWithWorkspaceContext({ workspaceId: PAID_WORKSPACE_ID }, () => effectiveEntitlements())
    ).resolves.toEqual({
      seatCapacity: 3,
      serviceAccountRequestsPerMinute: 60,
      workspaceRequestsPerMinute: 120,
      writesAllowed: true,
    });

    const events = await runWithWorkspaceContext({ workspaceId: PAID_WORKSPACE_ID }, () =>
      db.select().from(auditEvents)
    );
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "billing.state_transition",
          payload: { from: "Trialing", to: "Active", reason: "provider_projection" },
        }),
      ])
    );

    const outbox = await runWithWorkspaceContext({ workspaceId: PAID_WORKSPACE_ID }, () =>
      db.select().from(outboxEvents)
    );
    expect(outbox).toEqual([
      expect.objectContaining({
        workspaceId: PAID_WORKSPACE_ID,
        type: "billing.entitlements_changed",
        version: 1,
        aggregateType: "workspace_billing",
        aggregateId: PAID_WORKSPACE_ID,
        payload: { authorizationVersion: 2 },
      }),
    ]);
    expect(provider.fetches).toEqual([SUBSCRIPTION_ID]);
  });

  it("does not apply a duplicate provider event id as a new mutation", async () => {
    const {
      ingestBillingWebhook,
      getBillingProjection,
      handleProjectBillingJob,
      BILLING_PROJECT_JOB,
    } = await import("../../server/modules/billing");
    const { runWithWorkspaceContext } = await import("../../server/workspaceContext");
    const { createJobRunner } = await import("../../server/worker");
    const { db } = await import("../../server/db");
    const { jobs, outboxEvents } = await import("../../shared/schema");

    const provider = new FakeBillingProvider();
    provider.subscriptions.set(SUBSCRIPTION_ID, PROVIDER_SUB);
    const jobsPort = await billingJobs();
    await plantPaidWorkspace();

    const first = await ingestBillingWebhook({
      provider,
      jobs: jobsPort,
      payload: signedPayload(),
      signature: "signed",
    });
    const second = await ingestBillingWebhook({
      provider,
      jobs: jobsPort,
      payload: signedPayload(),
      signature: "signed",
    });
    expect(first.duplicate).toBe(false);
    expect(second).toMatchObject({ accepted: true, duplicate: true, enqueued: false });
    expect(await db.select().from(jobs)).toHaveLength(1);

    const worker = createJobRunner({
      role: "worker",
      jobs: jobsPort,
      handlers: {
        [BILLING_PROJECT_JOB]: (job) => handleProjectBillingJob(job, provider),
      },
      claimerId: "worker-1",
    });
    await worker.runOne();
    await worker.runOne();

    const pin = await runWithWorkspaceContext({ workspaceId: PAID_WORKSPACE_ID }, () =>
      getBillingProjection()
    );
    expect(pin.authorizationVersion).toBe(2);
    const outbox = await runWithWorkspaceContext({ workspaceId: PAID_WORKSPACE_ID }, () =>
      db.select().from(outboxEvents)
    );
    expect(outbox).toHaveLength(1);
    expect(provider.fetches).toEqual([SUBSCRIPTION_ID]);
  });
});

describe("drift Job", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("records an Audit Event and alerts when the provider disagrees, without overwriting the pin", async () => {
    const logger = await import("../../server/logger");
    const logWarn = vi.spyOn(logger, "logWarn").mockImplementation(() => {});

    const {
      handleBillingDriftJob,
      getBillingProjection,
      BILLING_DRIFT_JOB,
      BILLING_DRIFT_JOB_TYPE,
    } = await import("../../server/modules/billing");
    const { runWithWorkspaceContext } = await import("../../server/workspaceContext");
    const { createJobRunner } = await import("../../server/worker");
    const { createJobsPort } = await import("../../server/jobs");
    const { db } = await import("../../server/db");
    const { auditEvents } = await import("../../shared/schema");

    await plantPaidWorkspace();
    const provider = new FakeBillingProvider();
    provider.subscriptions.set(SUBSCRIPTION_ID, {
      ...PROVIDER_SUB,
      seatQuantity: 9,
      collectionState: "PastDue",
    });

    const jobsPort = createJobsPort({
      db,
      types: { [BILLING_DRIFT_JOB]: BILLING_DRIFT_JOB_TYPE },
    });
    await jobsPort.enqueue({
      type: BILLING_DRIFT_JOB,
      workspaceId: PAID_WORKSPACE_ID,
      occurrenceKey: "billing.drift:2026-09-02",
    });

    const worker = createJobRunner({
      role: "worker",
      jobs: jobsPort,
      handlers: {
        [BILLING_DRIFT_JOB]: (job) => handleBillingDriftJob(job, provider),
      },
      claimerId: "worker-1",
    });
    await worker.runOne();

    const pin = await runWithWorkspaceContext({ workspaceId: PAID_WORKSPACE_ID }, () =>
      getBillingProjection()
    );
    expect(pin).toMatchObject({
      billingState: "Trialing",
      planKey: "trial",
      purchasedSeatCapacity: 1,
      authorizationVersion: 1,
    });

    const events = await runWithWorkspaceContext({ workspaceId: PAID_WORKSPACE_ID }, () =>
      db.select().from(auditEvents)
    );
    expect(events).toEqual([
      expect.objectContaining({
        action: "billing.drift_detected",
        resourceType: "workspace_billing",
        resourceId: PAID_WORKSPACE_ID,
        actorKind: "system",
      }),
    ]);
    expect(logWarn).toHaveBeenCalledWith(
      "billing.drift",
      expect.objectContaining({ workspaceId: PAID_WORKSPACE_ID })
    );
    expect(provider.fetches).toEqual([SUBSCRIPTION_ID]);
    logWarn.mockRestore();
  });

  it("skips fetch for the seeded Workspace and does not clobber a pinned legacy pin", async () => {
    const { handleBillingDriftJob, getBillingProjection, BILLING_DRIFT_JOB, BILLING_DRIFT_JOB_TYPE } =
      await import("../../server/modules/billing");
    const { inSeededWorkspace } = await import("../helpers/workspace");
    const { createJobRunner } = await import("../../server/worker");
    const { createJobsPort } = await import("../../server/jobs");
    const { db } = await import("../../server/db");
    const { SEEDED_WORKSPACE_ID, auditEvents } = await import("../../shared/schema");

    const provider = new FakeBillingProvider();
    provider.subscriptions.set("sub_should_not_fetch", PROVIDER_SUB);

    const jobsPort = createJobsPort({
      db,
      types: { [BILLING_DRIFT_JOB]: BILLING_DRIFT_JOB_TYPE },
    });
    await jobsPort.enqueue({
      type: BILLING_DRIFT_JOB,
      workspaceId: SEEDED_WORKSPACE_ID,
      occurrenceKey: "billing.drift:2026-09-02",
    });

    const worker = createJobRunner({
      role: "worker",
      jobs: jobsPort,
      handlers: {
        [BILLING_DRIFT_JOB]: (job) => handleBillingDriftJob(job, provider),
      },
      claimerId: "worker-1",
    });
    await worker.runOne();

    const pin = await inSeededWorkspace(() => getBillingProjection());
    expect(pin).toMatchObject({
      planKey: "legacy",
      billingState: "Active",
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      authorizationVersion: 1,
    });
    expect(provider.fetches).toEqual([]);
    const events = await inSeededWorkspace(() => db.select().from(auditEvents));
    expect(events).toEqual([]);
  });
});

describe("HTTP webhook and drift schedule", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("expands drift Jobs on the Worker, not on HTTP, and skips Workspaces with no Stripe objects", async () => {
    const { createJobsPort } = await import("../../server/jobs");
    const { db } = await import("../../server/db");
    const { BILLING_DRIFT_JOB, BILLING_DRIFT_JOB_TYPE } = await import(
      "../../server/modules/billing"
    );
    const { createBillingDriftScheduler } = await import("../../server/scheduler");
    const { jobs } = await import("../../shared/schema");

    await plantPaidWorkspace();
    const jobsPort = createJobsPort({
      db,
      types: { [BILLING_DRIFT_JOB]: BILLING_DRIFT_JOB_TYPE },
    });
    const at = new Date("2026-09-02T12:00:00.000Z");
    const worker = createBillingDriftScheduler({
      role: "worker",
      jobs: jobsPort,
      holderId: "worker-1",
      now: () => at,
    });
    const http = createBillingDriftScheduler({
      role: "http",
      jobs: jobsPort,
      holderId: "http-1",
      now: () => at,
    });

    expect(await http.tick()).toBe(0);
    expect(await worker.tick()).toBe(1);
    expect(await worker.tick()).toBe(0);

    const queued = await db.select().from(jobs);
    expect(queued).toEqual([
      expect.objectContaining({
        type: BILLING_DRIFT_JOB,
        workspaceId: PAID_WORKSPACE_ID,
        occurrenceKey: "billing.drift:2026-09-02",
      }),
    ]);
  });
});

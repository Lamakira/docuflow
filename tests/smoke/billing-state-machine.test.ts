import { beforeEach, describe, expect, it } from "vitest";
import { workspaces, workspaceRoles } from "../../shared/schema";
import { resetDb } from "../helpers/db";

/**
 * Phase 8 ticket #140: billing state machine and Read-only Workspace.
 * Seams: Billing module transitions, and HTTP write-classification
 * (denied mutation vs allowed recovery). Stripe webhooks are not this suite.
 */

const TRIAL_WORKSPACE_ID = "trialing";
const STARTED_AT = new Date("2026-01-01T00:00:00.000Z");
const TRIAL_ENDS_AT = new Date("2026-01-15T00:00:00.000Z");
const SYSTEM = { kind: "system" as const };

async function plantUnpinnedWorkspace(id = TRIAL_WORKSPACE_ID) {
  const { db } = await import("../../server/db");
  await db.insert(workspaces).values({ id, name: "Trial" });
  await db.insert(workspaceRoles).values({
    id: `${id}-owner`,
    workspaceId: id,
    slug: "owner",
    name: "Owner",
  });
}

describe("Trialing Workspace", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("pins Trialing with no Stripe ids and a 14-day duration from registry version 1", async () => {
    const { runWithWorkspaceContext } = await import("../../server/workspaceContext");
    const { startTrial, getBillingProjection, effectiveEntitlements, PLAN_REGISTRY } = await import(
      "../../server/modules/billing"
    );

    expect(PLAN_REGISTRY[1].trial.trialDurationDays).toBe(14);
    await plantUnpinnedWorkspace();

    const pin = await runWithWorkspaceContext({ workspaceId: TRIAL_WORKSPACE_ID }, () =>
      startTrial(SYSTEM, { now: STARTED_AT })
    );

    expect(pin).toMatchObject({
      workspaceId: TRIAL_WORKSPACE_ID,
      planKey: "trial",
      registryVersion: 1,
      billingState: "Trialing",
      purchasedSeatCapacity: 1,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      cancelAtPeriodEnd: false,
      trialEndsAt: TRIAL_ENDS_AT,
      periodEndsAt: null,
    });

    await expect(
      runWithWorkspaceContext({ workspaceId: TRIAL_WORKSPACE_ID }, () => effectiveEntitlements())
    ).resolves.toMatchObject({ writesAllowed: true, seatCapacity: 1 });

    await expect(
      runWithWorkspaceContext({ workspaceId: TRIAL_WORKSPACE_ID }, () => getBillingProjection())
    ).resolves.toMatchObject({
      billingState: "Trialing",
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      trialEndsAt: TRIAL_ENDS_AT,
    });
  });

  it("expires Trialing without conversion into ReadOnly, as an Audit Event that bumps authorization version", async () => {
    const { runWithWorkspaceContext } = await import("../../server/workspaceContext");
    const { db } = await import("../../server/db");
    const { auditEvents, jobs } = await import("../../shared/schema");
    const {
      startTrial,
      expireTrial,
      getBillingProjection,
      effectiveEntitlements,
    } = await import("../../server/modules/billing");

    await plantUnpinnedWorkspace();
    await runWithWorkspaceContext({ workspaceId: TRIAL_WORKSPACE_ID }, () =>
      startTrial(SYSTEM, { now: STARTED_AT })
    );

    const after = await runWithWorkspaceContext({ workspaceId: TRIAL_WORKSPACE_ID }, () =>
      expireTrial(SYSTEM, { now: TRIAL_ENDS_AT })
    );
    expect(after.billingState).toBe("ReadOnly");
    expect(after.authorizationVersion).toBe(2);
    expect(after.stripeCustomerId).toBeNull();
    expect(after.stripeSubscriptionId).toBeNull();

    await expect(
      runWithWorkspaceContext({ workspaceId: TRIAL_WORKSPACE_ID }, () => effectiveEntitlements())
    ).resolves.toMatchObject({ writesAllowed: false });

    const pin = await runWithWorkspaceContext({ workspaceId: TRIAL_WORKSPACE_ID }, () =>
      getBillingProjection()
    );
    expect(pin.billingState).toBe("ReadOnly");
    expect(pin.authorizationVersion).toBe(2);

    const events = await runWithWorkspaceContext({ workspaceId: TRIAL_WORKSPACE_ID }, () =>
      db.select().from(auditEvents)
    );
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          workspaceId: TRIAL_WORKSPACE_ID,
          actorKind: "system",
          action: "billing.state_transition",
          resourceType: "workspace_billing",
          resourceId: TRIAL_WORKSPACE_ID,
          payload: { from: "Trialing", to: "ReadOnly", reason: "trial_expired" },
        }),
      ])
    );

    const queuedJobs = await db.select().from(jobs);
    expect(queuedJobs).toEqual([]);
  });
});

describe("PastDue Workspace", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("keeps operational writes after markPastDue", async () => {
    const { inSeededWorkspace } = await import("../helpers/workspace");
    const { markPastDue, effectiveEntitlements, getBillingProjection, assertOperationalWrite } =
      await import("../../server/modules/billing");

    const after = await inSeededWorkspace(() => markPastDue(SYSTEM));
    expect(after.billingState).toBe("PastDue");
    expect(after.authorizationVersion).toBe(2);

    await expect(inSeededWorkspace(() => effectiveEntitlements())).resolves.toMatchObject({
      writesAllowed: true,
    });
    await expect(inSeededWorkspace(() => assertOperationalWrite())).resolves.toBeUndefined();

    const pin = await inSeededWorkspace(() => getBillingProjection());
    expect(pin.billingState).toBe("PastDue");
  });

  it("becomes ReadOnly when dunning is exhausted", async () => {
    const { inSeededWorkspace } = await import("../helpers/workspace");
    const { db } = await import("../../server/db");
    const { auditEvents } = await import("../../shared/schema");
    const {
      markPastDue,
      exhaustDunning,
      effectiveEntitlements,
      assertOperationalWrite,
      ReadOnlyWorkspaceError,
    } = await import("../../server/modules/billing");

    await inSeededWorkspace(() => markPastDue(SYSTEM));
    const after = await inSeededWorkspace(() => exhaustDunning(SYSTEM));
    expect(after.billingState).toBe("ReadOnly");
    expect(after.authorizationVersion).toBe(3);

    await expect(inSeededWorkspace(() => effectiveEntitlements())).resolves.toMatchObject({
      writesAllowed: false,
    });
    await expect(inSeededWorkspace(() => assertOperationalWrite())).rejects.toBeInstanceOf(
      ReadOnlyWorkspaceError
    );

    const events = await inSeededWorkspace(() => db.select().from(auditEvents));
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "billing.state_transition",
          payload: { from: "PastDue", to: "ReadOnly", reason: "dunning_exhausted" },
        }),
      ])
    );
  });
});

describe("cancel-at-period-end", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("becomes ReadOnly when cancel-at-period-end reaches period end", async () => {
    const { inSeededWorkspace } = await import("../helpers/workspace");
    const PERIOD_END = new Date("2026-02-01T00:00:00.000Z");
    const {
      cancelAtPeriodEnd,
      applyPeriodEnd,
      getBillingProjection,
      effectiveEntitlements,
    } = await import("../../server/modules/billing");

    const flagged = await inSeededWorkspace(() =>
      cancelAtPeriodEnd(SYSTEM, { periodEndsAt: PERIOD_END })
    );
    expect(flagged.billingState).toBe("Active");
    expect(flagged.cancelAtPeriodEnd).toBe(true);
    expect(flagged.periodEndsAt).toEqual(PERIOD_END);

    const after = await inSeededWorkspace(() => applyPeriodEnd(SYSTEM, { now: PERIOD_END }));
    expect(after.billingState).toBe("ReadOnly");
    await expect(inSeededWorkspace(() => effectiveEntitlements())).resolves.toMatchObject({
      writesAllowed: false,
    });
    await expect(inSeededWorkspace(() => getBillingProjection())).resolves.toMatchObject({
      billingState: "ReadOnly",
      cancelAtPeriodEnd: true,
    });
  });

  it("rejects cancel-at-period-end while Trialing", async () => {
    const { runWithWorkspaceContext } = await import("../../server/workspaceContext");
    const { startTrial, cancelAtPeriodEnd, InvalidBillingTransitionError } = await import(
      "../../server/modules/billing"
    );

    await plantUnpinnedWorkspace();
    await runWithWorkspaceContext({ workspaceId: TRIAL_WORKSPACE_ID }, () =>
      startTrial(SYSTEM, { now: STARTED_AT })
    );

    await expect(
      runWithWorkspaceContext({ workspaceId: TRIAL_WORKSPACE_ID }, () => cancelAtPeriodEnd(SYSTEM))
    ).rejects.toBeInstanceOf(InvalidBillingTransitionError);
  });
});

describe("Read-only Workspace HTTP", () => {
  beforeEach(async () => {
    await resetDb();
  });

  async function readOnlyServiceAccount(
    app: Awaited<ReturnType<typeof import("../helpers/app").makeApp>>,
    capabilityIds: string[]
  ) {
    const { registerUser, setWorkspaceRole, newAgent } = await import("../helpers/auth");
    const { inSeededWorkspace } = await import("../helpers/workspace");
    const { markPastDue, exhaustDunning } = await import("../../server/modules/billing");
    const admin = await registerUser(app);
    await setWorkspaceRole(admin.id, "owner");
    const created = await admin.agent
      .post("/api/service-accounts")
      .send({ name: "CRM", capabilityIds });
    expect(created.status).toBe(201);
    await inSeededWorkspace(async () => {
      await markPastDue(SYSTEM);
      await exhaustDunning(SYSTEM);
    });
    return {
      admin,
      agent: newAgent(app).set("Authorization", `Bearer ${created.body.plaintextKey}`),
    };
  }

  it("denies a mutating /api/v1 Client create with a Read-only error, not forbidden", async () => {
    const { CLIENTS_WRITE_CAPABILITY_ID, CLIENTS_READ_CAPABILITY_ID } = await import(
      "../../shared/schema"
    );
    const { makeApp } = await import("../helpers/app");
    const app = await makeApp();
    const { agent } = await readOnlyServiceAccount(app, [
      CLIENTS_WRITE_CAPABILITY_ID,
      CLIENTS_READ_CAPABILITY_ID,
    ]);

    const created = await agent.post("/api/v1/clients").send({ name: "Acme" });
    expect(created.status).toBe(403);
    expect(created.headers["content-type"]).toMatch(/application\/problem\+json/);
    expect(created.body).toMatchObject({
      type: "urn:docuflow:problem:read-only-workspace",
      title: "Read-only Workspace",
      status: 403,
    });
    expect(created.body.type).not.toBe("urn:docuflow:problem:forbidden");

    const listed = await agent.get("/api/v1/clients");
    expect(listed.status).toBe(200);
  });

  it("denies a mutating /api/v1 Webhook Endpoint create with the same Read-only error", async () => {
    const { WEBHOOK_ENDPOINTS_MANAGE_CAPABILITY_ID } = await import("../../shared/schema");
    const { makeApp } = await import("../helpers/app");
    const app = await makeApp();
    const { agent } = await readOnlyServiceAccount(app, [WEBHOOK_ENDPOINTS_MANAGE_CAPABILITY_ID]);

    const created = await agent.post("/api/v1/webhook-endpoints").send({
      url: "https://example.test/hooks",
      eventTypes: ["client.created"],
    });
    expect(created.status).toBe(403);
    expect(created.body).toMatchObject({
      type: "urn:docuflow:problem:read-only-workspace",
      status: 403,
    });
  });

  it("still allows a billing-recovery call and denies a web BFF mutation", async () => {
    const { makeApp } = await import("../helpers/app");
    const { registerUser, setWorkspaceRole } = await import("../helpers/auth");
    const { inSeededWorkspace } = await import("../helpers/workspace");
    const { markPastDue, exhaustDunning, getBillingProjection } = await import(
      "../../server/modules/billing"
    );

    const app = await makeApp();
    const admin = await registerUser(app);
    await setWorkspaceRole(admin.id, "owner");
    await inSeededWorkspace(async () => {
      await markPastDue(SYSTEM);
      await exhaustDunning(SYSTEM);
    });

    const recovered = await admin.agent.post("/api/billing/cancel-at-period-end").send({});
    expect(recovered.status).toBe(200);
    expect(recovered.body).toMatchObject({
      billingState: "ReadOnly",
      cancelAtPeriodEnd: true,
    });

    const pin = await inSeededWorkspace(() => getBillingProjection());
    expect(pin.cancelAtPeriodEnd).toBe(true);

    const mutation = await admin.agent.post("/api/crm/clients").send({ name: "Acme" });
    expect(mutation.status).toBe(403);
    expect(mutation.body).toEqual({ message: "Workspace is read-only" });
  });
});

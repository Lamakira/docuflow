import { beforeEach, describe, expect, it } from "vitest";
import { SEEDED_WORKSPACE_ID } from "../../shared/schema";
import { makeApp } from "../helpers/app";
import { newAgent, registerUser, setWorkspaceRole } from "../helpers/auth";
import { resetDb } from "../helpers/db";
import { inSeededWorkspace } from "../helpers/workspace";

/**
 * Phase 8 ticket #139: Plan Registry and derived Entitlements. The seams are
 * the Billing module (catalog, pin, overrides) and HTTP `/api/v1` 429s.
 * Characterization of `/api/*` stays green. Stripe is not this suite.
 */

describe("Plan Registry catalog", () => {
  it("defines version 1 Plans legacy, trial, and pro with Entitlement values, not a second rate-limit module", async () => {
    const { PLAN_REGISTRY, PLAN_REGISTRY_VERSION, PUBLIC_API_RATE_LIMITS } = await import(
      "../../server/modules/billing"
    );

    expect(PLAN_REGISTRY_VERSION).toBe(1);
    expect(PLAN_REGISTRY[1]?.legacy).toEqual({
      seatCapacity: 500,
      serviceAccountRequestsPerMinute: 60,
      workspaceRequestsPerMinute: 120,
    });
    expect(PLAN_REGISTRY[1]?.trial).toEqual({
      seatCapacity: 1,
      trialDurationDays: 14,
      serviceAccountRequestsPerMinute: 60,
      workspaceRequestsPerMinute: 120,
    });
    expect(PLAN_REGISTRY[1]?.pro).toEqual({
      seatCapacity: "purchased",
      minimumSeatCapacity: 1,
      serviceAccountRequestsPerMinute: 60,
      workspaceRequestsPerMinute: 120,
    });
    expect(PUBLIC_API_RATE_LIMITS).toEqual({
      serviceAccountRequestsPerMinute: PLAN_REGISTRY[1].legacy.serviceAccountRequestsPerMinute,
      workspaceRequestsPerMinute: PLAN_REGISTRY[1].legacy.workspaceRequestsPerMinute,
    });
  });

  it("derives Entitlements from billing state, Plan, and registry version; a newer version does not change a v1 pin", async () => {
    const { deriveEntitlements, PLAN_REGISTRY } = await import("../../server/modules/billing");

    const v1Legacy = deriveEntitlements({
      planKey: "legacy",
      registryVersion: 1,
      billingState: "Active",
      purchasedSeatCapacity: 500,
    });
    expect(v1Legacy).toEqual({
      seatCapacity: 500,
      serviceAccountRequestsPerMinute: 60,
      workspaceRequestsPerMinute: 120,
      writesAllowed: true,
    });

    const v2Registry = {
      ...PLAN_REGISTRY,
      2: {
        legacy: {
          seatCapacity: 10,
          serviceAccountRequestsPerMinute: 1,
          workspaceRequestsPerMinute: 2,
        },
        trial: PLAN_REGISTRY[1].trial,
        pro: PLAN_REGISTRY[1].pro,
      },
    };

    expect(
      deriveEntitlements(
        {
          planKey: "legacy",
          registryVersion: 1,
          billingState: "Active",
          purchasedSeatCapacity: 500,
        },
        v2Registry
      )
    ).toEqual(v1Legacy);

    expect(
      deriveEntitlements(
        {
          planKey: "legacy",
          registryVersion: 2,
          billingState: "Active",
          purchasedSeatCapacity: 500,
        },
        v2Registry
      ).serviceAccountRequestsPerMinute
    ).toBe(1);

    expect(
      deriveEntitlements({
        planKey: "trial",
        registryVersion: 1,
        billingState: "Trialing",
        purchasedSeatCapacity: 1,
      })
    ).toMatchObject({ seatCapacity: 1, writesAllowed: true });

    expect(
      deriveEntitlements({
        planKey: "pro",
        registryVersion: 1,
        billingState: "Active",
        purchasedSeatCapacity: 8,
      }).seatCapacity
    ).toBe(8);

    expect(
      deriveEntitlements({
        planKey: "legacy",
        registryVersion: 1,
        billingState: "ReadOnly",
        purchasedSeatCapacity: 500,
      }).writesAllowed
    ).toBe(false);
  });
});

describe("seeded Workspace pin", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("pins the seeded Workspace to legacy / version 1 / Active with no Stripe objects", async () => {
    const { effectiveEntitlements, getBillingProjection } = await import(
      "../../server/modules/billing"
    );

    const pin = await inSeededWorkspace(() => getBillingProjection());
    expect(pin).toEqual({
      workspaceId: SEEDED_WORKSPACE_ID,
      planKey: "legacy",
      registryVersion: 1,
      billingState: "Active",
      purchasedSeatCapacity: 500,
      authorizationVersion: 1,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      trialEndsAt: null,
      periodEndsAt: null,
      cancelAtPeriodEnd: false,
    });

    await expect(inSeededWorkspace(() => effectiveEntitlements())).resolves.toEqual({
      seatCapacity: 500,
      serviceAccountRequestsPerMinute: 60,
      workspaceRequestsPerMinute: 120,
      writesAllowed: true,
    });
  });

  it("does not silently adopt a newer registry version when the pin is removed", async () => {
    const { db } = await import("../../server/db");
    const { workspaceBilling } = await import("../../shared/schema");
    const { BillingPinMissingError, effectiveEntitlements } = await import(
      "../../server/modules/billing"
    );

    await db.delete(workspaceBilling);

    await expect(inSeededWorkspace(() => effectiveEntitlements())).rejects.toBeInstanceOf(
      BillingPinMissingError
    );
  });
});

describe("Entitlement overrides", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("applies an audited per-Workspace override as an Audit Event, not an Outbox Event", async () => {
    const { db } = await import("../../server/db");
    const { auditEvents, jobs } = await import("../../shared/schema");
    const { effectiveEntitlements, getBillingProjection, setEntitlementOverride } = await import(
      "../../server/modules/billing"
    );

    const after = await inSeededWorkspace(() =>
      setEntitlementOverride(
        { serviceAccountRequestsPerMinute: 2 },
        { kind: "system" }
      )
    );
    expect(after.serviceAccountRequestsPerMinute).toBe(2);
    expect(after.workspaceRequestsPerMinute).toBe(120);
    expect(after.seatCapacity).toBe(500);

    const pin = await inSeededWorkspace(() => getBillingProjection());
    expect(pin.authorizationVersion).toBe(2);

    await expect(inSeededWorkspace(() => effectiveEntitlements())).resolves.toMatchObject({
      serviceAccountRequestsPerMinute: 2,
      workspaceRequestsPerMinute: 120,
    });

    const events = await inSeededWorkspace(() => db.select().from(auditEvents));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      workspaceId: SEEDED_WORKSPACE_ID,
      actorKind: "system",
      action: "entitlement_override.set",
      resourceType: "workspace_entitlement_overrides",
      resourceId: SEEDED_WORKSPACE_ID,
    });
    expect(events[0].payload).toEqual({ serviceAccountRequestsPerMinute: 2 });

    const queuedJobs = await db.select().from(jobs);
    expect(queuedJobs).toEqual([]);
  });
});

describe("public /api/v1 rate-limit substitution", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("429s a Service Account at the Entitlement limit after an override, not a Billing-shell constant", async () => {
    const { setEntitlementOverride } = await import("../../server/modules/billing");
    const app = await makeApp();
    const admin = await registerUser(app);
    await setWorkspaceRole(admin.id, "owner");
    const created = await admin.agent.post("/api/service-accounts").send({ name: "CRM" });
    const agent = newAgent(app).set("Authorization", `Bearer ${created.body.plaintextKey}`);

    await inSeededWorkspace(() =>
      setEntitlementOverride(
        { serviceAccountRequestsPerMinute: 2 },
        { kind: "system" }
      )
    );

    expect((await agent.get("/api/v1")).status).toBe(200);
    expect((await agent.get("/api/v1")).status).toBe(200);
    const throttled = await agent.get("/api/v1");
    expect(throttled.status).toBe(429);
    expect(throttled.body).toMatchObject({
      type: "urn:docuflow:problem:rate-limited",
      status: 429,
    });
  });
});

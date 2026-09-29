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

const EVERY_FEATURE = {
  activityCapture: true,
  payrollExports: true,
  crm: true,
  projectManagement: true,
  knowledge: true,
  advancedAnalytics: true,
  sso: true,
};

/** The pricing page's comparison table (#299), one row per Plan. */
const PRICING_TABLE = {
  starter: {
    activityCapture: false,
    payrollExports: false,
    crm: false,
    projectManagement: false,
    knowledge: false,
    advancedAnalytics: false,
    sso: false,
  },
  growth: {
    activityCapture: true,
    payrollExports: true,
    crm: true,
    projectManagement: true,
    knowledge: true,
    advancedAnalytics: false,
    sso: false,
  },
  business: {
    activityCapture: true,
    payrollExports: true,
    crm: true,
    projectManagement: true,
    knowledge: true,
    advancedAnalytics: true,
    sso: false,
  },
  enterprise: EVERY_FEATURE,
} as const;

const RATE_LIMITS = { serviceAccountRequestsPerMinute: 60, workspaceRequestsPerMinute: 120 };

describe("Plan Registry catalog", () => {
  it("keeps version 1 Plans legacy, trial, and pro as the whole product, not a second rate-limit module", async () => {
    const { PLAN_REGISTRY, PUBLIC_API_RATE_LIMITS } = await import("../../server/modules/billing");

    expect(PLAN_REGISTRY[1]?.legacy).toEqual({
      seatCapacity: 500,
      ...RATE_LIMITS,
      features: EVERY_FEATURE,
      screenshotProjectCapacity: null,
    });
    expect(PLAN_REGISTRY[1]?.trial).toEqual({
      seatCapacity: 1,
      trialDurationDays: 14,
      ...RATE_LIMITS,
      features: EVERY_FEATURE,
      screenshotProjectCapacity: null,
    });
    expect(PLAN_REGISTRY[1]?.pro).toEqual({
      seatCapacity: "purchased",
      minimumSeatCapacity: 1,
      ...RATE_LIMITS,
      features: EVERY_FEATURE,
      screenshotProjectCapacity: null,
    });
    expect(PUBLIC_API_RATE_LIMITS).toEqual({
      serviceAccountRequestsPerMinute: PLAN_REGISTRY[1].legacy!.serviceAccountRequestsPerMinute,
      workspaceRequestsPerMinute: PLAN_REGISTRY[1].legacy!.workspaceRequestsPerMinute,
    });
  });

  it("defines version 2 as the pricing page's table, per seat, with no storage, AI or Device limits", async () => {
    const { PLAN_REGISTRY, PLAN_REGISTRY_VERSION } = await import("../../server/modules/billing");

    expect(PLAN_REGISTRY_VERSION).toBe(2);
    const v2 = PLAN_REGISTRY[2]!;
    expect(Object.keys(v2).sort()).toEqual(["business", "enterprise", "growth", "starter", "trial"]);
    for (const [planKey, features] of Object.entries(PRICING_TABLE)) {
      const plan = v2[planKey as keyof typeof PRICING_TABLE]!;
      expect(plan.features, planKey).toEqual(features);
      expect(plan.seatCapacity, planKey).toBe("purchased");
      expect(plan, planKey).toMatchObject(RATE_LIMITS);
      expect(Object.keys(plan).some((key) => /storage|ai|device/i.test(key)), planKey).toBe(false);
    }
    expect(v2.starter!.screenshotProjectCapacity).toBe(1);
    expect(v2.growth!.screenshotProjectCapacity).toBeNull();
    expect(v2.business!.screenshotProjectCapacity).toBeNull();
    expect(v2.enterprise!.screenshotProjectCapacity).toBeNull();
    expect(v2.enterprise!.salesLed).toBe(true);
    expect(v2.enterprise!.lookupKeys).toBeUndefined();
  });

  it("names the six Stripe lookup keys in the registry, not in env vars", async () => {
    const { PLAN_REGISTRY } = await import("../../server/modules/billing");

    expect(PLAN_REGISTRY[2]!.starter!.lookupKeys).toEqual({
      monthly: "starter_monthly",
      annual: "starter_annual",
    });
    expect(PLAN_REGISTRY[2]!.growth!.lookupKeys).toEqual({
      monthly: "growth_monthly",
      annual: "growth_annual",
    });
    expect(PLAN_REGISTRY[2]!.business!.lookupKeys).toEqual({
      monthly: "business_monthly",
      annual: "business_annual",
    });
  });

  it("gives the v2 Trial Business features, 3 seats and 14 days", async () => {
    const { PLAN_REGISTRY } = await import("../../server/modules/billing");

    expect(PLAN_REGISTRY[2]!.trial).toEqual({
      seatCapacity: 3,
      trialDurationDays: 14,
      ...RATE_LIMITS,
      features: PRICING_TABLE.business,
      screenshotProjectCapacity: null,
    });
  });

  it("names the cheapest Plan that includes each area, for upgrade messages", async () => {
    const { minimumPlanFor } = await import("../../server/modules/billing");

    expect(minimumPlanFor("crm")).toBe("growth");
    expect(minimumPlanFor("knowledge")).toBe("growth");
    expect(minimumPlanFor("activityCapture")).toBe("growth");
    expect(minimumPlanFor("payrollExports")).toBe("growth");
    expect(minimumPlanFor("projectManagement")).toBe("growth");
    expect(minimumPlanFor("advancedAnalytics")).toBe("business");
    expect(minimumPlanFor("sso")).toBe("enterprise");
  });

  it("places a v1 pro Subscription under v1 until migrated, then as Business", async () => {
    const { placePlan, PLAN_MIGRATIONS } = await import("../../server/modules/billing");

    expect(PLAN_MIGRATIONS[1]).toEqual({ pro: "business" });
    expect(placePlan("pro", 1)).toEqual({ planKey: "pro", registryVersion: 1 });
    expect(placePlan("pro", 2)).toEqual({ planKey: "business", registryVersion: 2 });
    expect(placePlan("starter", 1)).toEqual({ planKey: "starter", registryVersion: 2 });
    expect(placePlan("growth", 2)).toEqual({ planKey: "growth", registryVersion: 2 });
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
      ...RATE_LIMITS,
      writesAllowed: true,
      features: EVERY_FEATURE,
      screenshotProjectCapacity: null,
    });

    const v3Registry = {
      ...PLAN_REGISTRY,
      3: {
        legacy: {
          seatCapacity: 10,
          serviceAccountRequestsPerMinute: 1,
          workspaceRequestsPerMinute: 2,
          features: PRICING_TABLE.starter,
          screenshotProjectCapacity: 1,
        },
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
        v3Registry
      )
    ).toEqual(v1Legacy);

    expect(
      deriveEntitlements(
        {
          planKey: "legacy",
          registryVersion: 3,
          billingState: "Active",
          purchasedSeatCapacity: 500,
        },
        v3Registry
      ).serviceAccountRequestsPerMinute
    ).toBe(1);

    expect(
      deriveEntitlements({
        planKey: "trial",
        registryVersion: 1,
        billingState: "Trialing",
        purchasedSeatCapacity: 1,
      })
    ).toMatchObject({ seatCapacity: 1, writesAllowed: true, features: EVERY_FEATURE });

    expect(
      deriveEntitlements({
        planKey: "pro",
        registryVersion: 1,
        billingState: "Active",
        purchasedSeatCapacity: 8,
      })
    ).toMatchObject({ seatCapacity: 8, features: EVERY_FEATURE, screenshotProjectCapacity: null });

    expect(
      deriveEntitlements({
        planKey: "starter",
        registryVersion: 2,
        billingState: "Active",
        purchasedSeatCapacity: 4,
      })
    ).toMatchObject({ seatCapacity: 4, features: PRICING_TABLE.starter, screenshotProjectCapacity: 1 });

    expect(
      deriveEntitlements({
        planKey: "legacy",
        registryVersion: 1,
        billingState: "ReadOnly",
        purchasedSeatCapacity: 500,
      }).writesAllowed
    ).toBe(false);
  });

  it("applies an Enterprise-style feature override over the Plan's own features", async () => {
    const { deriveEntitlements } = await import("../../server/modules/billing");

    expect(
      deriveEntitlements({
        planKey: "growth",
        registryVersion: 2,
        billingState: "Active",
        purchasedSeatCapacity: 5,
        overrides: { features: { advancedAnalytics: true } },
      }).features
    ).toEqual({ ...PRICING_TABLE.growth, advancedAnalytics: true });
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
      billingInterval: null,
    });

    await expect(inSeededWorkspace(() => effectiveEntitlements())).resolves.toEqual({
      seatCapacity: 500,
      ...RATE_LIMITS,
      writesAllowed: true,
      features: EVERY_FEATURE,
      screenshotProjectCapacity: null,
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

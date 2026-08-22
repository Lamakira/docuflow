/**
 * Versioned Plan Registry (#139, ADR-0008, ADR-0010). Effective Entitlements
 * are a pure function of billing state, Plan, and registry version. Workspaces
 * pin to a version so a later catalog never silently changes what they bought.
 */

export const PLAN_REGISTRY_VERSION = 1 as const;

export type PlanKey = "legacy" | "trial" | "pro";
export type BillingState = "Trialing" | "Active" | "PastDue" | "ReadOnly";

export type PlanDefinition = {
  seatCapacity: number | "purchased";
  minimumSeatCapacity?: number;
  trialDurationDays?: number;
  serviceAccountRequestsPerMinute: number;
  workspaceRequestsPerMinute: number;
};

export type PlanRegistry = Record<number, Record<PlanKey, PlanDefinition>>;

export const PLAN_REGISTRY: PlanRegistry = {
  [PLAN_REGISTRY_VERSION]: {
    legacy: {
      seatCapacity: 500,
      serviceAccountRequestsPerMinute: 60,
      workspaceRequestsPerMinute: 120,
    },
    trial: {
      seatCapacity: 1,
      trialDurationDays: 14,
      serviceAccountRequestsPerMinute: 60,
      workspaceRequestsPerMinute: 120,
    },
    pro: {
      seatCapacity: "purchased",
      minimumSeatCapacity: 1,
      serviceAccountRequestsPerMinute: 60,
      workspaceRequestsPerMinute: 120,
    },
  },
};

/** v1 `legacy` rate limits — derived from registry version 1, not a second source. */
export const PUBLIC_API_RATE_LIMITS = {
  serviceAccountRequestsPerMinute: PLAN_REGISTRY[1].legacy.serviceAccountRequestsPerMinute,
  workspaceRequestsPerMinute: PLAN_REGISTRY[1].legacy.workspaceRequestsPerMinute,
} as const;

export type Entitlements = {
  seatCapacity: number;
  serviceAccountRequestsPerMinute: number;
  workspaceRequestsPerMinute: number;
  writesAllowed: boolean;
};

export type EntitlementOverrideValues = {
  seatCapacity?: number;
  serviceAccountRequestsPerMinute?: number;
  workspaceRequestsPerMinute?: number;
};

export type BillingPinInput = {
  planKey: PlanKey;
  registryVersion: number;
  billingState: BillingState;
  purchasedSeatCapacity: number;
  overrides?: EntitlementOverrideValues;
};

export class UnknownRegistryVersionError extends Error {
  constructor(version: number) {
    super(`Unknown Plan Registry version ${version}`);
    this.name = "UnknownRegistryVersionError";
  }
}

export class UnknownPlanError extends Error {
  constructor(planKey: string, version: number) {
    super(`Unknown Plan ${planKey} in registry version ${version}`);
    this.name = "UnknownPlanError";
  }
}

export function deriveEntitlements(
  pin: BillingPinInput,
  registry: PlanRegistry = PLAN_REGISTRY
): Entitlements {
  const plans = registry[pin.registryVersion];
  if (!plans) throw new UnknownRegistryVersionError(pin.registryVersion);
  const plan = plans[pin.planKey];
  if (!plan) throw new UnknownPlanError(pin.planKey, pin.registryVersion);

  const seatCapacity =
    plan.seatCapacity === "purchased"
      ? Math.max(plan.minimumSeatCapacity ?? 1, pin.purchasedSeatCapacity)
      : plan.seatCapacity;

  return {
    seatCapacity: pin.overrides?.seatCapacity ?? seatCapacity,
    serviceAccountRequestsPerMinute:
      pin.overrides?.serviceAccountRequestsPerMinute ?? plan.serviceAccountRequestsPerMinute,
    workspaceRequestsPerMinute:
      pin.overrides?.workspaceRequestsPerMinute ?? plan.workspaceRequestsPerMinute,
    writesAllowed: pin.billingState !== "ReadOnly",
  };
}

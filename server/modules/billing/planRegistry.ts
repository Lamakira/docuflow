/**
 * Versioned Plan Registry (#139, #299, ADR-0008, ADR-0010, ADR-0027). Effective
 * Entitlements are a pure function of billing state, Plan, and registry
 * version. Workspaces pin to a version so a later catalog never silently
 * changes what they bought.
 *
 * Version 2 follows the pricing page's comparison table: a Plan may leave out
 * areas, Starter is the entry tier, and the Trial shows the complete product.
 */

export const PLAN_REGISTRY_VERSION = 2 as const;

export type PlanKey =
  | "legacy"
  | "trial"
  | "pro"
  | "starter"
  | "growth"
  | "business"
  | "enterprise";
export type BillingState = "Trialing" | "Active" | "PastDue" | "ReadOnly";
export type BillingInterval = "monthly" | "annual";

/** The Plans a Workspace can buy through Checkout. Enterprise is sales-led. */
export const PRICED_PLAN_KEYS = ["starter", "growth", "business"] as const;
export type PricedPlanKey = (typeof PRICED_PLAN_KEYS)[number];
export const BILLING_INTERVALS: readonly BillingInterval[] = ["monthly", "annual"];

/** Areas a Plan may leave out. Time tracking itself is never one of them. */
export const FEATURE_KEYS = [
  "activityCapture",
  "payrollExports",
  "crm",
  "projectManagement",
  "knowledge",
  "advancedAnalytics",
  "sso",
] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];
export type PlanFeatures = Record<FeatureKey, boolean>;

export const FEATURE_LABEL: Record<FeatureKey, string> = {
  activityCapture: "activity and idle detection",
  payrollExports: "payroll-ready exports",
  crm: "Clients and Opportunities",
  projectManagement: "tasks, budgets and the Project Dossier",
  knowledge: "Documents, Files, transcription and Ask",
  advancedAnalytics: "advanced analytics and profitability dashboards",
  sso: "SSO, SCIM and data residency",
};

export const PLAN_LABEL: Record<PlanKey, string> = {
  legacy: "Legacy",
  trial: "Trial",
  pro: "Pro",
  starter: "Starter",
  growth: "Growth",
  business: "Business",
  enterprise: "Enterprise",
};

export type PlanDefinition = {
  seatCapacity: number | "purchased";
  minimumSeatCapacity?: number;
  trialDurationDays?: number;
  serviceAccountRequestsPerMinute: number;
  workspaceRequestsPerMinute: number;
  features: PlanFeatures;
  /** Projects screenshots may be captured on. Null is every Project. */
  screenshotProjectCapacity: number | null;
  /** Stripe Price lookup keys, one per billing interval. Never a Price id. */
  lookupKeys?: Record<BillingInterval, string>;
  /** Changed only by an audited assignment, never by Checkout or the provider projection. */
  salesLed?: true;
};

export type PlanRegistry = Record<number, Partial<Record<PlanKey, PlanDefinition>>>;

const RATE_LIMITS = { serviceAccountRequestsPerMinute: 60, workspaceRequestsPerMinute: 120 } as const;

function features(included: FeatureKey[]): PlanFeatures {
  return Object.fromEntries(FEATURE_KEYS.map((key) => [key, included.includes(key)])) as PlanFeatures;
}

const EVERY_FEATURE = features([...FEATURE_KEYS]);
const GROWTH_FEATURES: FeatureKey[] = [
  "activityCapture",
  "payrollExports",
  "crm",
  "projectManagement",
  "knowledge",
];
const BUSINESS_FEATURES: FeatureKey[] = [...GROWTH_FEATURES, "advancedAnalytics"];

export const PLAN_REGISTRY: PlanRegistry = {
  // Version 1 predates Plans that leave areas out: every v1 Plan is the whole product.
  1: {
    legacy: {
      seatCapacity: 500,
      ...RATE_LIMITS,
      features: EVERY_FEATURE,
      screenshotProjectCapacity: null,
    },
    trial: {
      seatCapacity: 1,
      trialDurationDays: 14,
      ...RATE_LIMITS,
      features: EVERY_FEATURE,
      screenshotProjectCapacity: null,
    },
    pro: {
      seatCapacity: "purchased",
      minimumSeatCapacity: 1,
      ...RATE_LIMITS,
      features: EVERY_FEATURE,
      screenshotProjectCapacity: null,
    },
  },
  2: {
    trial: {
      seatCapacity: 3,
      trialDurationDays: 14,
      ...RATE_LIMITS,
      features: features(BUSINESS_FEATURES),
      screenshotProjectCapacity: null,
    },
    starter: {
      seatCapacity: "purchased",
      minimumSeatCapacity: 1,
      ...RATE_LIMITS,
      features: features([]),
      screenshotProjectCapacity: 1,
      lookupKeys: { monthly: "starter_monthly", annual: "starter_annual" },
    },
    growth: {
      seatCapacity: "purchased",
      minimumSeatCapacity: 1,
      ...RATE_LIMITS,
      features: features(GROWTH_FEATURES),
      screenshotProjectCapacity: null,
      lookupKeys: { monthly: "growth_monthly", annual: "growth_annual" },
    },
    business: {
      seatCapacity: "purchased",
      minimumSeatCapacity: 1,
      ...RATE_LIMITS,
      features: features(BUSINESS_FEATURES),
      screenshotProjectCapacity: null,
      lookupKeys: { monthly: "business_monthly", annual: "business_annual" },
    },
    enterprise: {
      seatCapacity: "purchased",
      minimumSeatCapacity: 1,
      ...RATE_LIMITS,
      features: EVERY_FEATURE,
      screenshotProjectCapacity: null,
      salesLed: true,
    },
  },
};

/**
 * Where a v1 Plan lands when its Workspace is deliberately migrated. `pro`
 * becomes Business so no feature is lost (#299). `legacy` and a v1 `trial`
 * have no successor and stay pinned to version 1.
 */
export const PLAN_MIGRATIONS: Record<number, Partial<Record<PlanKey, PlanKey>>> = {
  1: { pro: "business" },
};

/** The Plans in the order a Workspace climbs them, for "Upgrade to …" copy. */
export const PLAN_LADDER: readonly PlanKey[] = ["starter", "growth", "business", "enterprise"];

/** v1 `legacy` rate limits — derived from registry version 1, not a second source. */
export const PUBLIC_API_RATE_LIMITS = {
  serviceAccountRequestsPerMinute: PLAN_REGISTRY[1].legacy!.serviceAccountRequestsPerMinute,
  workspaceRequestsPerMinute: PLAN_REGISTRY[1].legacy!.workspaceRequestsPerMinute,
} as const;

export type Entitlements = {
  seatCapacity: number;
  serviceAccountRequestsPerMinute: number;
  workspaceRequestsPerMinute: number;
  writesAllowed: boolean;
  features: PlanFeatures;
  screenshotProjectCapacity: number | null;
};

export type EntitlementOverrideValues = {
  seatCapacity?: number;
  serviceAccountRequestsPerMinute?: number;
  workspaceRequestsPerMinute?: number;
  features?: Partial<PlanFeatures>;
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

export function isPlanKey(value: string): value is PlanKey {
  return value in PLAN_LABEL;
}

export function isFeatureKey(value: string): value is FeatureKey {
  return (FEATURE_KEYS as readonly string[]).includes(value);
}

export function planDefinition(
  planKey: PlanKey,
  registryVersion: number,
  registry: PlanRegistry = PLAN_REGISTRY
): PlanDefinition {
  const plans = registry[registryVersion];
  if (!plans) throw new UnknownRegistryVersionError(registryVersion);
  const plan = plans[planKey];
  if (!plan) throw new UnknownPlanError(planKey, registryVersion);
  return plan;
}

/**
 * The registry version a Plan the provider reports belongs under, for a pin
 * currently at `pinnedVersion`. A Plan still in the pinned version keeps it; a
 * v1 Plan on a migrated pin reads as its successor; anything else is current.
 */
export function placePlan(
  planKey: PlanKey,
  pinnedVersion: number
): { planKey: PlanKey; registryVersion: number } {
  if (PLAN_REGISTRY[pinnedVersion]?.[planKey]) return { planKey, registryVersion: pinnedVersion };
  for (const [version, mapping] of Object.entries(PLAN_MIGRATIONS)) {
    const successor = mapping[planKey];
    if (successor && Number(version) < pinnedVersion && PLAN_REGISTRY[pinnedVersion]?.[successor]) {
      return { planKey: successor, registryVersion: pinnedVersion };
    }
  }
  return { planKey, registryVersion: PLAN_REGISTRY_VERSION };
}

/** Whether the Plan's seats are bought through a Subscription. */
export function purchasesSeats(planKey: PlanKey, registryVersion: number): boolean {
  return PLAN_REGISTRY[registryVersion]?.[planKey]?.seatCapacity === "purchased";
}

/** The cheapest current Plan that includes a feature. */
export function minimumPlanFor(feature: FeatureKey, registry: PlanRegistry = PLAN_REGISTRY): PlanKey {
  const plans = registry[PLAN_REGISTRY_VERSION] ?? {};
  return PLAN_LADDER.find((key) => plans[key]?.features[feature]) ?? "enterprise";
}

/** The cheapest current Plan with no screenshot Project capacity. */
export function unlimitedScreenshotPlan(registry: PlanRegistry = PLAN_REGISTRY): PlanKey {
  const plans = registry[PLAN_REGISTRY_VERSION] ?? {};
  return PLAN_LADDER.find((key) => plans[key] && plans[key]!.screenshotProjectCapacity == null) ?? "enterprise";
}

export function deriveEntitlements(
  pin: BillingPinInput,
  registry: PlanRegistry = PLAN_REGISTRY
): Entitlements {
  const plan = planDefinition(pin.planKey, pin.registryVersion, registry);

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
    features: { ...plan.features, ...(pin.overrides?.features ?? {}) },
    screenshotProjectCapacity: plan.screenshotProjectCapacity,
  };
}

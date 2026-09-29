/**
 * The Workspace's Plan as the v2 chrome reads it (#299).
 *
 * The server decides every refusal; this only says, ahead of the click, which
 * destinations the Plan leaves out. An area whose data survives a downgrade
 * reads as read-only; an area with nothing to keep reads as an upgrade.
 */

import { useQuery } from "@tanstack/react-query";
import type { V2NavId } from "./presentation";

export type FeatureKey =
  | "activityCapture"
  | "payrollExports"
  | "crm"
  | "projectManagement"
  | "knowledge"
  | "advancedAnalytics"
  | "sso";

export type PricedPlanKey = "starter" | "growth" | "business";
export type BillingInterval = "monthly" | "annual";

export type PlanSummary = {
  planKey: string;
  label: string;
  features: Record<FeatureKey, boolean>;
  screenshotProjectCapacity: number | null;
  priced: boolean;
};

export type Entitlements = {
  planKey: string;
  planLabel: string;
  registryVersion: number;
  billingState: string;
  billingInterval: BillingInterval | null;
  trialEndsAt: string | null;
  /** The Plan picked on the pricing page before sign-up. Enterprise included; it grants nothing. */
  intendedPlanKey: string | null;
  intendedInterval: BillingInterval | null;
  features: Record<FeatureKey, boolean>;
  screenshotProjectCapacity: number | null;
  requiredPlan: Record<FeatureKey, string>;
  plans: PlanSummary[];
};

export function entitlementsPath(): string {
  return "/api/billing/entitlements";
}

export function billingPlanPath(): string {
  return "/api/billing/plan";
}

export function useEntitlements() {
  return useQuery<Entitlements | null>({
    queryKey: [entitlementsPath()],
    queryFn: async () => {
      const res = await fetch(entitlementsPath(), { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
  });
}

/** What each area is called in a Plan sentence; mirrors the server's FEATURE_LABEL. */
export const FEATURE_LABEL: Record<FeatureKey, string> = {
  activityCapture: "activity and idle detection",
  payrollExports: "payroll-ready exports",
  crm: "Clients and Opportunities",
  projectManagement: "tasks, budgets and the Project Dossier",
  knowledge: "Documents, Files, transcription and Ask",
  advancedAnalytics: "advanced analytics and profitability dashboards",
  sso: "SSO, SCIM and data residency",
};

const NAV_FEATURE: Partial<Record<V2NavId, { feature: FeatureKey; kept: boolean }>> = {
  opportunities: { feature: "crm", kept: true },
  clients: { feature: "crm", kept: true },
  documents: { feature: "knowledge", kept: true },
  "project-documentation": { feature: "knowledge", kept: true },
  analytics: { feature: "advancedAnalytics", kept: false },
};

export type PlanGate = {
  feature: FeatureKey;
  /** "read-only": what exists stays readable. "upgrade": the area does not open. */
  kind: "read-only" | "upgrade";
  requiredPlan: string;
};

function planName(entitlements: Entitlements, planKey: string): string {
  return entitlements.plans.find((plan) => plan.planKey === planKey)?.label ?? planKey;
}

export function planGateFor(navId: V2NavId | null, entitlements: Entitlements | null | undefined): PlanGate | null {
  if (!navId || !entitlements) return null;
  const gate = NAV_FEATURE[navId];
  if (!gate || entitlements.features[gate.feature]) return null;
  return {
    feature: gate.feature,
    kind: gate.kept ? "read-only" : "upgrade",
    requiredPlan: planName(entitlements, entitlements.requiredPlan[gate.feature]),
  };
}

function sentenceStart(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The banner a gated destination opens under. */
export function planGateCopy(gate: PlanGate, entitlements: Entitlements): string {
  const label = FEATURE_LABEL[gate.feature];
  if (gate.kind === "read-only") {
    return (
      `${sentenceStart(label)} are read-only on the ${entitlements.planLabel} Plan. ` +
      `What is here stays visible; upgrade to ${gate.requiredPlan} in Administration → Billing to make changes.`
    );
  }
  return (
    `The ${entitlements.planLabel} Plan does not include ${label}. ` +
    `Upgrade to ${gate.requiredPlan} in Administration → Billing to use it.`
  );
}

/** The Plans a Workspace can move to from the Billing tab, cheapest first. */
export function pricedPlans(entitlements: Entitlements | null | undefined): PlanSummary[] {
  return (entitlements?.plans ?? []).filter((plan) => plan.priced);
}

const INCLUDED_ORDER: FeatureKey[] = [
  "activityCapture",
  "payrollExports",
  "crm",
  "projectManagement",
  "knowledge",
  "advancedAnalytics",
  "sso",
];

/** One line for a Plan card: what it adds on top of time tracking. */
export function planIncludes(plan: PlanSummary): string {
  const screenshots =
    plan.screenshotProjectCapacity == null
      ? "screenshots on every Project"
      : `screenshots on ${plan.screenshotProjectCapacity} Project`;
  const areas = INCLUDED_ORDER.filter((feature) => plan.features[feature]).map((feature) => FEATURE_LABEL[feature]);
  return sentenceStart(["time tracking", screenshots, ...areas].join(", ")) + ".";
}

export const BILLING_INTERVAL_LABEL: Record<BillingInterval, string> = {
  monthly: "Monthly",
  annual: "Annual",
};

/** A Workspace that never bought a Plan: on the Trial, or Read-only after it. */
function awaitsCheckout(entitlements: Entitlements): boolean {
  if (pricedPlans(entitlements).some((plan) => plan.planKey === entitlements.planKey)) return false;
  return entitlements.billingState === "Trialing" || entitlements.billingState === "ReadOnly";
}

/** The pricing-page Plan Billing opens on, while the Workspace has not bought one. */
export function intendedPricedPlan(entitlements: Entitlements | null | undefined): PricedPlanKey | null {
  if (!entitlements || !awaitsCheckout(entitlements)) return null;
  const planKey = entitlements.intendedPlanKey;
  return pricedPlans(entitlements).some((plan) => plan.planKey === planKey) ? (planKey as PricedPlanKey) : null;
}

/** The line above the Plan cards that remembers the pricing-page choice. */
export function planIntentNote(entitlements: Entitlements | null | undefined): string | null {
  if (!entitlements?.intendedPlanKey || !awaitsCheckout(entitlements)) return null;
  const label = planName(entitlements, entitlements.intendedPlanKey);
  if (entitlements.intendedPlanKey === "enterprise") {
    return (
      `You chose ${label} when you signed up. ${label} is agreed with DocuFlow sales rather than bought through Checkout; ` +
      "choose a Plan below to keep the Workspace writable in the meantime."
    );
  }
  return `You chose ${label} when you signed up.`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export type TrialNotice = { copy: string; action: string };

/** The shell's Trial countdown, with the pricing-page Plan as the way forward. */
export function trialNotice(entitlements: Entitlements | null | undefined, now: Date = new Date()): TrialNotice | null {
  if (!entitlements || entitlements.billingState !== "Trialing" || !entitlements.trialEndsAt) return null;
  const days = Math.max(0, Math.ceil((new Date(entitlements.trialEndsAt).getTime() - now.getTime()) / DAY_MS));
  const copy =
    days === 0 ? "Your Trial ends today." : `Your Trial ends in ${days} ${days === 1 ? "day" : "days"}.`;
  const intended = intendedPricedPlan(entitlements);
  return { copy, action: intended ? `Continue with ${planName(entitlements, intended)}` : "Choose a Plan" };
}

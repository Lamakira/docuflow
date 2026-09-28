/**
 * The Plan a visitor picked on the marketing site's pricing page (#299).
 *
 * The site links each Plan card to `/signup?plan=<name>`. The choice is an
 * intent, not a purchase: the Workspace still starts on the Trial, and the
 * intent only decides what Billing offers first. Enterprise is kept as intent
 * even though it has no Checkout, because it is agreed with sales.
 */

export const INTENDED_PLAN_KEYS = ["starter", "growth", "business", "enterprise"] as const;
export type IntendedPlanKey = (typeof INTENDED_PLAN_KEYS)[number];
export type IntendedInterval = "monthly" | "annual";

export type PlanIntent = {
  planKey: IntendedPlanKey;
  interval: IntendedInterval | null;
};

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/** Unknown Plans read as no intent; an unknown interval is dropped on its own. */
export function parsePlanIntent(plan: unknown, interval?: unknown): PlanIntent | null {
  const planKey = clean(plan);
  if (!(INTENDED_PLAN_KEYS as readonly string[]).includes(planKey)) return null;
  const cadence = clean(interval);
  return {
    planKey: planKey as IntendedPlanKey,
    interval: cadence === "monthly" || cadence === "annual" ? cadence : null,
  };
}

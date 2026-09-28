/**
 * Carries the marketing site's `?plan=` from sign-up to the first Workspace.
 *
 * Clerk's sign-up drops the query string on its way back to `/`, and email
 * verification may finish in another tab, so the intent waits in
 * `localStorage` until `POST /api/workspaces` takes it.
 */

import { parsePlanIntent, type PlanIntent } from "@shared/planIntent";

export const PLAN_INTENT_KEY = "docuflow.planIntent";

type IntentStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function browserStorage(): IntentStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Keeps a valid `?plan=` from the sign-up URL. A link without one leaves an earlier choice alone. */
export function capturePlanIntent(search: string, storage: IntentStorage | null = browserStorage()): PlanIntent | null {
  const params = new URLSearchParams(search);
  const intent = parsePlanIntent(params.get("plan"), params.get("interval"));
  if (intent && storage) storage.setItem(PLAN_INTENT_KEY, JSON.stringify(intent));
  return intent;
}

export function readPlanIntent(storage: IntentStorage | null = browserStorage()): PlanIntent | null {
  const raw = storage?.getItem(PLAN_INTENT_KEY);
  if (!raw) return null;
  try {
    const stored = JSON.parse(raw) as { planKey?: unknown; interval?: unknown };
    return parsePlanIntent(stored.planKey, stored.interval);
  } catch {
    return null;
  }
}

export function clearPlanIntent(storage: IntentStorage | null = browserStorage()): void {
  storage?.removeItem(PLAN_INTENT_KEY);
}

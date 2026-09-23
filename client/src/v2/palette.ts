/**
 * Which colour a status or a meter wears. Amber is what is active or in
 * progress, green what is finished or signed off, carmine what is overdue,
 * blocked, or refused. Everything else stays neutral: colour carries a state,
 * never decoration. tokens.css maps each tone onto the ramps.
 */

export type StatusTone = "active" | "positive" | "alert" | "neutral";

const STATUS_TONE: Record<string, StatusTone> = {
  ACTIVE: "active",
  "IN PROGRESS": "active",
  "IN REVIEW": "active",
  COMPLETED: "positive",
  DONE: "positive",
  APPROVED: "positive",
  "SIGNED OFF": "positive",
  WON: "positive",
  ONLINE: "positive",
  OVERDUE: "alert",
  BLOCKED: "alert",
  REFUSED: "alert",
  LOST: "alert",
};

/** A Project, Task, or Device status label, as the composers print it. */
export function statusTone(status: string | null | undefined): StatusTone {
  if (!status) return "neutral";
  return STATUS_TONE[status.trim().toUpperCase()] ?? "neutral";
}

/**
 * An Opportunity's open stages are named by the Workspace, so no word list can
 * know them: every open stage is in progress, and only the terminal ones say
 * how it ended.
 */
export function opportunityStageTone(stage: string, terminal: boolean): StatusTone {
  if (!terminal) return "active";
  return statusTone(stage);
}

/** Read-only is a Workspace blocked from writing; Past due is overdue. */
export function billingConditionTone(condition: string | null | undefined): StatusTone {
  if (condition === "Past due" || condition === "Read-only") return "alert";
  return "neutral";
}

export type MeterTone = "within" | "over" | "paused";

/** A budget meter: green while inside the budget, carmine once past it. */
export function meterTone(percent: number | null | undefined, status?: string | null): MeterTone {
  if (percent != null && percent > 100) return "over";
  const label = status?.trim().toUpperCase();
  if (label === "ON HOLD" || label === "ARCHIVED") return "paused";
  return "within";
}

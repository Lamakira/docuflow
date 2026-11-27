/**
 * Simultaneous Timers (#400, ADR-0031): up to three Timers at once when the
 * Workspace's Tracking Policy allows it, and Worked Time counted once.
 *
 * Pure: no Node or Electron imports, so the renderer reads these too.
 */

/** Mirrors the server's MAX_SIMULTANEOUS_TIMERS. */
export const MAX_SIMULTANEOUS_TIMERS = 3;
export const TIMER_LIMIT_MESSAGE = `You run ${MAX_SIMULTANEOUS_TIMERS} Timers. Stop one to add another.`;
export const TASK_HAS_TIMER_MESSAGE = "A Timer already runs on this task.";

/** `add` keeps the other Timers; `switch` (or no mode) stops them, as one Timer did. */
export type StartMode = "add" | "switch";

export type TimerRunStatus = "running" | "paused";

export interface StartChoice {
  /** Ask the Member whether to add this Timer or switch to it. */
  ask: boolean;
  /** Add is offered. */
  canAdd: boolean;
  /** Why Add is not offered, shown beside Switch. */
  note: string | null;
}

/**
 * What Start does. With the option off, or nothing active, it switches without
 * asking, as before. With the option on and a Timer active it asks, offering
 * Switch only when three Timers run or the task already has one.
 */
export function startChoice(input: {
  simultaneousTimersEnabled: boolean;
  activeCount: number;
  taskHasTimer?: boolean;
}): StartChoice {
  if (!input.simultaneousTimersEnabled || input.activeCount === 0) {
    return { ask: false, canAdd: false, note: null };
  }
  if (input.activeCount >= MAX_SIMULTANEOUS_TIMERS) {
    return { ask: true, canAdd: false, note: TIMER_LIMIT_MESSAGE };
  }
  if (input.taskHasTimer) return { ask: true, canAdd: false, note: TASK_HAS_TIMER_MESSAGE };
  return { ask: true, canAdd: true, note: null };
}

/** One status for "am I tracking?": running if any Timer runs, paused if any exists, else stopped. */
export function aggregateTimerStatus(timers: ReadonlyArray<{ status: string }>): "running" | "paused" | "stopped" {
  if (timers.some((t) => t.status === "running")) return "running";
  return timers.length > 0 ? "paused" : "stopped";
}

/** A Timer whose start has not reached the server yet. */
export function isLocalEntryId(entryId: string | null | undefined): boolean {
  return typeof entryId === "string" && entryId.startsWith("local-");
}

/**
 * Every running Timer the heartbeat names (`timeEntryIds`). The server checks
 * them as UUIDs, so a local placeholder would refuse the whole heartbeat.
 */
export function heartbeatTimeEntryIds(timers: ReadonlyArray<{ entryId: string; status: string }>): string[] {
  return timers
    .filter((t) => t.status === "running" && !isLocalEntryId(t.entryId))
    .map((t) => t.entryId)
    .slice(0, MAX_SIMULTANEOUS_TIMERS);
}

/**
 * Seconds of [from, to] covered by at least one interval (`any`) and by two or
 * more at once (`simultaneous`). Intervals are epoch ms; open ones end at `to`.
 */
export function coveredSeconds(
  intervals: ReadonlyArray<{ start: number; end: number }>,
  from: number,
  to: number,
): { any: number; simultaneous: number } {
  const points: Array<[number, number]> = [];
  for (const { start, end } of intervals) {
    const s = Math.max(start, from);
    const e = Math.min(end, to);
    if (e <= s) continue;
    points.push([s, 1], [e, -1]);
  }
  // Ends before starts at the same instant: back-to-back sessions do not overlap.
  points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let depth = 0;
  let last = 0;
  let any = 0;
  let simultaneous = 0;
  for (const [t, delta] of points) {
    if (depth >= 1) any += t - last;
    if (depth >= 2) simultaneous += t - last;
    depth += delta;
    last = t;
  }
  return { any: Math.floor(any / 1000), simultaneous: Math.floor(simultaneous / 1000) };
}

function hm(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

/** "4h 30m", the day total as every agent screen writes it. */
export function workedTimeValue(total: number): string {
  return hm(total);
}

/**
 * "1h 30m simultaneous", or null while no whole minute of it would show
 * ("0h 00m simultaneous" says nothing).
 */
export function simultaneousLabel(simultaneous: number): string | null {
  return simultaneous >= 60 ? `${hm(simultaneous)} simultaneous` : null;
}

/** "4h 30m · 1h 30m simultaneous"; the simultaneous part only when there is some. */
export function workedTimeLabel(total: number, simultaneous: number): string {
  const part = simultaneousLabel(simultaneous);
  return part ? `${workedTimeValue(total)} · ${part}` : workedTimeValue(total);
}

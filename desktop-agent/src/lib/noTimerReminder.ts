/**
 * No-timer reminder decisions (issue #351): nudge a Member who is working while
 * no Timer runs. Pure: no Electron, no store. main/index.ts supplies the facts
 * and shows the notification.
 */

export const NO_TIMER_REMINDER_MIN_STOPPED_MS = 5 * 60_000;
export const NO_TIMER_REMINDER_MIN_ACTIVE_MS = 2 * 60_000;
export const NO_TIMER_REMINDER_REPEAT_MS = 30 * 60_000;
/** Idle below this counts as active. */
export const NO_TIMER_REMINDER_ACTIVE_IDLE_SECONDS = 60;

/** Start of the current run of active checks: kept while active, null once idle. */
export function nextActiveSince(prev: number | null, idleSeconds: number, nowMs: number): number | null {
  if (idleSeconds >= NO_TIMER_REMINDER_ACTIVE_IDLE_SECONDS) return null;
  return prev ?? nowMs;
}

/** Nudge when stopped long enough, active for a few minutes in a row, and not nudged recently. */
export function noTimerReminderDue(input: {
  enabled: boolean;
  timerStatus: string;
  stoppedSinceMs: number;
  activeSinceMs: number | null;
  lastReminderAtMs: number;
  nowMs: number;
  withinActiveHours: boolean;
  blocked: boolean;
  /** False when the idle reading cannot tell away from active (Wayland without Mutter or uiohook). */
  idleSourceReliable: boolean;
}): boolean {
  if (!input.enabled || input.blocked || !input.withinActiveHours) return false;
  if (!input.idleSourceReliable) return false;
  if (input.timerStatus !== "stopped" || input.activeSinceMs === null) return false;
  if (input.nowMs - input.stoppedSinceMs < NO_TIMER_REMINDER_MIN_STOPPED_MS) return false;
  if (input.nowMs - input.activeSinceMs < NO_TIMER_REMINDER_MIN_ACTIVE_MS) return false;
  return input.nowMs - input.lastReminderAtMs >= NO_TIMER_REMINDER_REPEAT_MS;
}

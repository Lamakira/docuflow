/**
 * Paused-timer decisions (issue #330): when a pause began, whether it crossed a
 * local day, and when to remind a Member who is working while paused.
 * Pure: no Electron, no store. main/index.ts supplies the facts and acts on them.
 */

import { getLocalDayKey } from "./dayBoundary";

export const PAUSED_REMINDER_CHECK_MS = 30_000;
export const PAUSED_REMINDER_MIN_PAUSE_MS = 5 * 60_000;
export const PAUSED_REMINDER_REPEAT_MS = 15 * 60_000;
export const PAUSED_REMINDER_ACTIVE_IDLE_SECONDS = 60;

/**
 * When the active entry has been paused since: the latest session end for the entry,
 * else the entry start (lastActivityAt is refreshed by every heartbeat, so it can't
 * date a pause). Null when the timer is not paused.
 */
export function pausedSince(input: {
  timerStatus: string;
  activeEntryId: string | null;
  activeEntryStartTime: string | null;
  sessions: Array<{ entryId: string; endTime?: string | null }>;
}): Date | null {
  if (input.timerStatus !== "paused" || !input.activeEntryId) return null;
  let latest = 0;
  for (const s of input.sessions) {
    if (s.entryId !== input.activeEntryId || !s.endTime) continue;
    const t = Date.parse(s.endTime);
    if (!Number.isNaN(t) && t > latest) latest = t;
  }
  if (latest > 0) return new Date(latest);
  if (input.activeEntryStartTime) {
    const t = Date.parse(input.activeEntryStartTime);
    if (!Number.isNaN(t)) return new Date(t);
  }
  return null;
}

/** A paused entry must not survive into a new local day. */
export function pausedFromPreviousDay(pausedSinceMs: number, nowMs: number): boolean {
  return getLocalDayKey(pausedSinceMs) !== getLocalDayKey(nowMs);
}

/** Remind when the Member is active, the pause is old enough, and the last reminder is not recent. */
export function pausedReminderDue(input: {
  pausedSinceMs: number | null;
  nowMs: number;
  lastReminderAtMs: number;
  idleSeconds: number;
  idlePromptOpen: boolean;
}): boolean {
  if (input.pausedSinceMs === null || input.idlePromptOpen) return false;
  if (input.nowMs - input.pausedSinceMs < PAUSED_REMINDER_MIN_PAUSE_MS) return false;
  if (input.nowMs - input.lastReminderAtMs < PAUSED_REMINDER_REPEAT_MS) return false;
  return input.idleSeconds < PAUSED_REMINDER_ACTIVE_IDLE_SECONDS;
}

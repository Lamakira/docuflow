/**
 * Pure derived selectors for session-based time tracking.
 *
 * All functions are side-effect-free and accept an explicit `now` timestamp
 * so they can be tested without mocking Date.
 */

import { TrackingSession } from "./AgentStore";

/** Returns the currently active (open) session, or null. */
export function getActiveSession(sessions: TrackingSession[]): TrackingSession | null {
  return sessions.find((s) => s.endTime === null) ?? null;
}

/**
 * Elapsed milliseconds for the active session only (current run, since last start/resume).
 * Returns 0 when paused or stopped.
 */
export function getActiveSessionElapsedMs(
  sessions: TrackingSession[],
  now = Date.now()
): number {
  const active = getActiveSession(sessions);
  if (!active) return 0;
  return Math.max(0, now - new Date(active.startTime).getTime());
}

/**
 * Total milliseconds for all sessions belonging to a given entryId.
 * Includes the open session if running.
 */
export function getEntryTotalMs(
  sessions: TrackingSession[],
  entryId: string,
  now = Date.now()
): number {
  return sessions
    .filter((s) => s.entryId === entryId)
    .reduce((acc, s) => {
      const start = new Date(s.startTime).getTime();
      const end = s.endTime ? new Date(s.endTime).getTime() : now;
      return acc + Math.max(0, end - start);
    }, 0);
}

/**
 * Total milliseconds for all sessions with a given taskId.
 * Includes the open session if running.
 */
export function getTaskTotalMs(
  sessions: TrackingSession[],
  taskId: string,
  now = Date.now()
): number {
  return sessions
    .filter((s) => s.taskId === taskId)
    .reduce((acc, s) => {
      const start = new Date(s.startTime).getTime();
      const end = s.endTime ? new Date(s.endTime).getTime() : now;
      return acc + Math.max(0, end - start);
    }, 0);
}

/**
 * Total milliseconds worked today (all tasks, all entries).
 *
 * Sessions are clamped to [local midnight, now]:
 *   - Sessions starting before midnight only count from midnight onward.
 *   - Sessions ending after now are capped at now.
 *
 * This correctly handles midnight-crossing sessions and multi-day gaps.
 */
export function getWorkedTodayMs(sessions: TrackingSession[], now = Date.now()): number {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const midnight = todayStart.getTime();

  return sessions.reduce((acc, s) => {
    const start = new Date(s.startTime).getTime();
    const end = s.endTime ? new Date(s.endTime).getTime() : now;
    const cStart = Math.max(start, midnight);
    const cEnd = Math.min(end, now);
    if (cEnd <= cStart) return acc;
    return acc + (cEnd - cStart);
  }, 0);
}

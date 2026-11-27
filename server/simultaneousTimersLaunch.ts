/**
 * The launch of Simultaneous Timers (#400, ADR-0031). The code ships before the
 * launch: Members whose Devices still run an older agent are warned first, by
 * email and in the app. The operator sets `SIMULTANEOUS_TIMERS_LAUNCH_AT` (an
 * ISO date) once the new agent release is published. From that moment the
 * minimum agent protocol rises and the Tracking Policy option can be turned on.
 * Unset or unreadable: not launched.
 */

export const SIMULTANEOUS_TIMERS_LAUNCH_ENV = "SIMULTANEOUS_TIMERS_LAUNCH_AT";

export function simultaneousTimersLaunchAt(): Date | null {
  const raw = process.env[SIMULTANEOUS_TIMERS_LAUNCH_ENV]?.trim();
  if (!raw) return null;
  const at = new Date(raw);
  return Number.isNaN(at.getTime()) ? null : at;
}

export function simultaneousTimersLaunched(now: Date = new Date()): boolean {
  const at = simultaneousTimersLaunchAt();
  return at !== null && at.getTime() <= now.getTime();
}

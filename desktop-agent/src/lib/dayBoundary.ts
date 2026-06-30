/**
 * Local "day" boundaries for Worked Today / elapsedToday.
 *
 * In production, a day is the calendar day (local midnight → 23:59:59).
 * In test mode, set DOCUFLOW_TEST_DAY_ROLLOVER_SECONDS=N to treat each
 * N-second window as a separate "day" so P4 can be verified without waiting until midnight.
 */

export function getTestDayRolloverSeconds(): number | null {
  const raw = process.env.DOCUFLOW_TEST_DAY_ROLLOVER_SECONDS;
  if (!raw) return null;
  const sec = parseInt(raw, 10);
  return Number.isFinite(sec) && sec > 0 ? sec : null;
}

/** Stable string key for the current local day (or synthetic test day). */
export function getLocalDayKey(now = Date.now()): string {
  const rollover = getTestDayRolloverSeconds();
  if (rollover) {
    return `test-day-${Math.floor(now / (rollover * 1000))}`;
  }
  return new Date(now).toDateString();
}

/** Inclusive millisecond range [startMs, endMs] for the current local day window. */
export function getLocalDayWindowMs(now = Date.now()): { startMs: number; endMs: number } {
  const rollover = getTestDayRolloverSeconds();
  if (rollover) {
    const windowMs = rollover * 1000;
    const startMs = Math.floor(now / windowMs) * windowMs;
    return { startMs, endMs: startMs + windowMs - 1 };
  }
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const endOfDay = new Date(todayStart);
  endOfDay.setHours(23, 59, 59, 999);
  return { startMs: todayStart.getTime(), endMs: endOfDay.getTime() };
}

/**
 * What part of a Time Entry falls inside a period (F67). One rule, read by the
 * stats, the register, the agent's totals and the Task's time today.
 */

/** A running Time Entry silent for longer than this is stale: its Timer is not known to run any more. */
export const STALE_THRESHOLD_MS = 10 * 60 * 1000;

/** Either bound may be absent. Both are inclusive. */
export interface TimePeriod {
  start?: Date;
  end?: Date;
}

/** A Time Entry's whole wall time, and the seconds it holds. */
export interface TimeSpan {
  start: Date;
  end: Date;
  seconds: number;
  idleSeconds: number;
}

export interface TimeSpanSource {
  startTime: Date;
  endTime: Date | null;
  duration: number | null;
  idleTime: number | null;
  status: string;
  lastActivityAt: Date | null;
}

/**
 * A running entry counts the live seconds since `lastActivityAt`, as the web
 * Timer shows it. Once stale it counts what it holds and ends at its last sign
 * of life. A paused entry ends where it was paused.
 */
export function timeEntrySpan(entry: TimeSpanSource, now: Date): TimeSpan {
  let seconds = Math.max(0, entry.duration ?? 0);
  const impliedEnd = new Date(entry.startTime.getTime() + seconds * 1000);
  let end: Date;
  if (entry.status === "running") {
    const silentMs = entry.lastActivityAt ? now.getTime() - entry.lastActivityAt.getTime() : 0;
    const stale = silentMs > STALE_THRESHOLD_MS;
    if (!stale) seconds += Math.max(0, Math.floor(silentMs / 1000));
    end = stale ? entry.lastActivityAt! : now;
  } else if (entry.status === "paused") {
    end = entry.lastActivityAt ?? impliedEnd;
  } else {
    end = entry.endTime ?? impliedEnd;
  }
  if (end.getTime() < entry.startTime.getTime()) end = entry.startTime;
  return { start: entry.startTime, end, seconds, idleSeconds: Math.max(0, entry.idleTime ?? 0) };
}

/**
 * The seconds of `span` inside `period`, in proportion of its wall time, both
 * ends cut. The held seconds may be fewer than the wall time (idle removed) or
 * more; the proportion is the same. Rounded on the running total, so portions
 * of periods that follow one another add up to the entry.
 */
export function timePortion(span: TimeSpan, period: TimePeriod): { seconds: number; idleSeconds: number } {
  const start = span.start.getTime();
  const end = span.end.getTime();
  const from = Math.max(start, period.start?.getTime() ?? start);
  const to = Math.min(end, period.end?.getTime() ?? end);
  if (to < from) return { seconds: 0, idleSeconds: 0 };
  const wall = end - start;
  // No wall time to share out: the instant is in the period, so all of it is.
  if (wall <= 0) return { seconds: span.seconds, idleSeconds: span.idleSeconds };
  const upTo = (total: number, at: number) => Math.round((total * (at - start)) / wall);
  return {
    seconds: upTo(span.seconds, to) - upTo(span.seconds, from),
    idleSeconds: upTo(span.idleSeconds, to) - upTo(span.idleSeconds, from),
  };
}

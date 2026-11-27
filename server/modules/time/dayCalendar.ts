/**
 * Calendar days and clock hours in one IANA time zone. A day is 23 or 25 hours
 * long when the clocks change, so its start is found, never counted from noon.
 */

import { timePortion, type TimePeriod, type TimeSpan } from "@shared/timePortion";

const HOUR_MS = 60 * 60 * 1000;

export interface DayCalendar {
  /** "YYYY-MM-DD" */
  dayOf(at: Date): string;
  /** "HH:mm" */
  clockOf(at: Date): string;
  hourOf(at: Date): number;
  /** The first instant of the day. A day the zone skipped starts where the next one does. */
  startOfDay(day: string): Date;
}

export function dayCalendar(timeZone: string): DayCalendar {
  // One formatter for a whole report: building it costs far more than using it.
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const starts = new Map<string, Date>();

  const read = (at: Date) => {
    const parts: Record<string, string> = {};
    for (const part of formatter.formatToParts(at)) parts[part.type] = part.value;
    return {
      day: `${parts.year.padStart(4, "0")}-${parts.month}-${parts.day}`,
      hour: parts.hour,
      minute: parts.minute,
    };
  };
  const dayOf = (at: Date) => read(at).day;

  const startOfDay = (day: string): Date => {
    const known = starts.get(day);
    if (known) return known;
    const utcMidnight = Date.parse(`${day}T00:00:00.000Z`);
    // No zone is further than 14 hours from UTC today; the rest is margin.
    let before = utcMidnight - 26 * HOUR_MS;
    let from = utcMidnight + 26 * HOUR_MS;
    while (from - before > 1) {
      const middle = Math.floor((before + from) / 2);
      if (dayOf(new Date(middle)) < day) before = middle;
      else from = middle;
    }
    const start = new Date(from);
    starts.set(day, start);
    return start;
  };

  return {
    dayOf,
    clockOf: (at) => {
      const { hour, minute } = read(at);
      return `${hour}:${minute}`;
    },
    hourOf: (at) => Number(read(at).hour),
    startOfDay,
  };
}

/** The calendar day after `day` ("YYYY-MM-DD"). */
export function nextCalendarDay(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + 24 * HOUR_MS).toISOString().slice(0, 10);
}

/** A Time Entry's part of the period, split between its days. The days add up to `timePortion`. */
export function dayPortions(
  span: TimeSpan,
  period: Required<TimePeriod>,
  calendar: DayCalendar
): Array<{ date: string; seconds: number; idleSeconds: number }> {
  const end = new Date(Math.min(span.end.getTime(), period.end.getTime()));
  let at = new Date(Math.max(span.start.getTime(), period.start.getTime()));
  const days: Array<{ date: string; seconds: number; idleSeconds: number }> = [];
  if (end < at) return days;
  do {
    const date = calendar.dayOf(at);
    const next = calendar.startOfDay(nextCalendarDay(date));
    const until = next < end ? next : end;
    days.push({ date, ...timePortion(span, { start: at, end: until }) });
    at = until;
  } while (at < end);
  return days;
}

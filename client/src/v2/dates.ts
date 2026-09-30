const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * A date a register shows in full (#307): "29 Sep 2026". A timestamp reads in
 * the reader's time zone; a date-only field is stored at UTC midnight, so it
 * reads in UTC to land on the same day everywhere. The months are spelled here
 * rather than by Intl, whose short "Sep" differs between ICU versions.
 */
export function formatFullDate(
  value: Date | string | null | undefined,
  { dateOnly = false }: { dateOnly?: boolean } = {},
): string {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const day = dateOnly ? date.getUTCDate() : date.getDate();
  const month = dateOnly ? date.getUTCMonth() : date.getMonth();
  const year = dateOnly ? date.getUTCFullYear() : date.getFullYear();
  return `${day} ${MONTHS[month]} ${year}`;
}

/**
 * A `YYYY-MM-DD` day as the reader's calendar holds it: that day at local
 * midnight, so a calendar grid and a local range both land on the day chosen.
 */
export function dayToDate(day: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return undefined;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/** The local day a calendar click picked, as `YYYY-MM-DD`. */
export function dateToDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** The day a date-only field holds, as `YYYY-MM-DD`: stored at UTC midnight, so read in UTC. `""` when unset. */
export function utcDay(value: Date | string | null | undefined): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

/** A range of days, both included, as `YYYY-MM-DD` (#307). */
export type DayRange = { from: string; to: string };

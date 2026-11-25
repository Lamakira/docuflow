/**
 * Analytics (#212, F93-F100): one composer per card over the `/api/admin/analytics/*`
 * routes, each taking what its own read returned, so a card can load, fail or
 * refresh alone. Figures are read, never animated. Days and hours are the
 * reader's (the browser's time zone, sent as `tz`), as in Time Tracking.
 */

import { administrationRefusal, ANALYTICS_DESTINATION, canManageAdministration } from "./administration";
import { ACTIVITY_FILTERS_DEFAULT, writeActivityFilters } from "./activity";
import { dateToDay, dayToDate, MONTHS, type DayRange } from "./dates";
import { formatRelativeTime } from "./devices";
import { activityTabHref, timeTabHref } from "./presentation";
import { projectTasksHref, TIME_FILTERS_DEFAULT, writeTimeFilters } from "./time";
import { formatHours, projectHref } from "./today";
import { formatCount, type StatsChartTable } from "./backOffice";

/* ── The Range, in the address ─────────────────────────────────────────── */

export type AnalyticsRangeId = "7d" | "30d" | "90d" | "month" | "custom";

export type AnalyticsRange = { start: Date; end: Date };

export const ANALYTICS_RANGE_PRESETS: Array<{ id: AnalyticsRangeId; label: string }> = [
  { id: "7d", label: "Last 7 days" },
  { id: "30d", label: "Last 30 days" },
  { id: "90d", label: "Last 90 days" },
  { id: "month", label: "This month" },
  { id: "custom", label: "Custom range…" },
];

export const ANALYTICS_TABS = ["members", "projects", "tasks"] as const;
export type AnalyticsTab = (typeof ANALYTICS_TABS)[number];

export type AnalyticsFilters = { range: AnalyticsRangeId; from: string; to: string; tab: AnalyticsTab };

export const ANALYTICS_FILTERS_DEFAULT: AnalyticsFilters = { range: "7d", from: "", to: "", tab: "members" };

function readDay(params: URLSearchParams, name: string): string {
  const value = params.get(name) ?? "";
  const date = dayToDate(value);
  // 2026-13-40 would roll over into a real date; only a day that reads back as itself counts.
  return date && dateToDay(date) === value ? value : "";
}

/** An unknown value reads as its default; a Custom range without both days reads as the default week. */
export function readAnalyticsFilters(search: string): AnalyticsFilters {
  const params = new URLSearchParams(search);
  const asked = params.get("range") ?? "";
  const from = readDay(params, "from");
  const to = readDay(params, "to");
  const known = ANALYTICS_RANGE_PRESETS.some((preset) => preset.id === asked);
  const range = known && (asked !== "custom" || (from && to)) ? (asked as AnalyticsRangeId) : ANALYTICS_FILTERS_DEFAULT.range;
  const tab = params.get("tab") ?? "";
  return {
    range,
    from: range === "custom" ? from : "",
    to: range === "custom" ? to : "",
    tab: (ANALYTICS_TABS as readonly string[]).includes(tab) ? (tab as AnalyticsTab) : ANALYTICS_FILTERS_DEFAULT.tab,
  };
}

export function writeAnalyticsFilters(search: string, filters: AnalyticsFilters): string {
  const params = new URLSearchParams(search);
  const set = (name: string, value: string, fallback: string) => {
    if (value !== fallback) params.set(name, value);
    else params.delete(name);
  };
  set("range", filters.range, ANALYTICS_FILTERS_DEFAULT.range);
  set("from", filters.range === "custom" ? filters.from : "", "");
  set("to", filters.range === "custom" ? filters.to : "", "");
  set("tab", filters.tab, ANALYTICS_FILTERS_DEFAULT.tab);
  const query = params.toString();
  return query ? `?${query}` : "";
}

/** Picking Custom starts from the days on screen, so nothing is refetched. */
export function customFromRange(range: AnalyticsRange): DayRange {
  return { from: dateToDay(range.start), to: dateToDay(range.end) };
}

function startOfDay(year: number, month: number, day: number): Date {
  return new Date(year, month, day);
}

function endOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

const ROLLING_DAYS = { "7d": 7, "30d": 30, "90d": 90 } as const;

/**
 * The period Analytics reads: whole local days that end today. Last 7 days is
 * today and the 6 days before; This month runs from the 1st to today; a custom
 * range covers its first and last days in full.
 */
export function analyticsRange(
  preset: AnalyticsRangeId,
  today: Date,
  custom?: DayRange | null,
): AnalyticsRange {
  const year = today.getFullYear();
  const month = today.getMonth();
  const day = today.getDate();
  if (preset === "month") return { start: startOfDay(year, month, 1), end: endOfDay(today) };
  if (preset === "custom") {
    const from = custom ? dayToDate(custom.from) : undefined;
    const to = custom ? dayToDate(custom.to) : undefined;
    if (from && to) {
      const [first, last] = from <= to ? [from, to] : [to, from];
      return { start: first, end: endOfDay(last) };
    }
  }
  const days = preset === "30d" || preset === "90d" ? ROLLING_DAYS[preset] : ROLLING_DAYS["7d"];
  return { start: startOfDay(year, month, day - (days - 1)), end: endOfDay(today) };
}

function formatDay(value: Date, withYear: boolean): string {
  const text = `${value.getDate()} ${MONTHS[value.getMonth()]}`;
  return withYear ? `${text} ${value.getFullYear()}` : text;
}

/** The Range in words for the head: "19 Nov - 25 Nov", with the year when it is not this one. */
export function analyticsRangeWords(range: AnalyticsRange, today: Date): string {
  const withYear = range.start.getFullYear() !== today.getFullYear() || range.end.getFullYear() !== today.getFullYear();
  const first = formatDay(range.start, withYear);
  const last = formatDay(range.end, withYear);
  return first === last ? first : `${first} - ${last}`;
}

/* ── Paths ─────────────────────────────────────────────────────────────── */

export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export type AnalyticsReport = "productivity" | "coverage" | "alerts" | "screenshots" | "export";

/** The same start, end and tz on every report, so a custom range over the same days asks for the same thing. */
export function analyticsPath(report: AnalyticsReport, range: AnalyticsRange, tz: string): string {
  const params = new URLSearchParams();
  params.set("start", range.start.toISOString());
  params.set("end", range.end.toISOString());
  params.set("tz", tz);
  return `/api/admin/analytics/${report}?${params.toString()}`;
}

export function analyticsDevicesPath(tz: string): string {
  return `/api/admin/analytics/devices?${new URLSearchParams({ tz }).toString()}`;
}

/** The file's name as the server gave it; the Range's own days when the header is missing. */
export function exportFilename(contentDisposition: string | null, range: AnalyticsRange): string {
  const star = /filename\*=UTF-8''([^;]+)/i.exec(contentDisposition ?? "");
  if (star) {
    try {
      return decodeURIComponent(star[1].trim());
    } catch {
      // fall through to the plain form
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(contentDisposition ?? "");
  if (plain?.[1].trim()) return plain[1].trim();
  return `docuflow-time-${dateToDay(range.start)}-to-${dateToDay(range.end)}.csv`;
}

/* ── What the reads return ─────────────────────────────────────────────── */

export type AnalyticsProductivityInput = {
  byUser: Array<{
    userId: string;
    userName: string;
    totalSeconds: number;
    idleSeconds: number;
    entriesCount: number;
  }>;
  byProject: Array<{
    crmProjectId: string;
    projectName: string;
    clientName: string | null;
    totalSeconds: number;
    entriesCount: number;
  }>;
  byTask: Array<{
    taskId: string | null;
    taskName: string;
    crmProjectId: string | null;
    projectName: string | null;
    clientName: string | null;
    totalSeconds: number;
  }>;
  dailyTrend: Array<{ date: string; totalSeconds: number }>;
};

export type AnalyticsCoverageInput = {
  summary: {
    totalTrackedSeconds: number;
    totalScreenshots: number;
    expectedScreenshots: number;
    coveragePercent: number | null;
    totalEntries: number;
    entriesWithoutScreenshots: number;
    lowCoverageEntries: number;
    deletedScreenshots: number;
    captureEveryMinutes?: number | null;
  };
  byUser: Array<{
    userId: string;
    userName: string;
    trackedSeconds: number;
    entriesCount: number;
    entriesWithoutScreenshots: number;
    screenshotCount: number;
    expectedScreenshots: number;
    coveragePct: number | null;
  }>;
};

export type AnalyticsAlertsInput = {
  highIdleUsers: Array<{ userId: string; userName: string; idleRatio: number; totalSeconds: number }>;
  stalledDevices: Array<{
    deviceId: string;
    deviceName: string;
    userId: string;
    userName: string;
    lastSeenAt: string | Date | null;
    daysSinceLastSeen: number;
  }>;
  runningWithoutScreenshots: Array<{
    userId: string;
    userName: string;
    entryId: string;
    startedAt: string | Date;
  }>;
};

export type AnalyticsScreenshotsInput = {
  totalCount: number;
  hourlyDistribution: Array<{ hour: number; count: number }>;
};

export type AnalyticsDeviceInput = {
  id: string;
  userId: string;
  userName: string;
  name: string;
  os: string | null;
  clientVersion: string | null;
  lastSeenAt: string | Date | null;
  revokedAt: string | Date | null;
};

/* ── The refusal ───────────────────────────────────────────────────────── */

/** The named refusal, or `null` for a reader the gate admits whose reads were not refused. */
export function analyticsRefusal(input: {
  workspaceRole: string;
  ownerName: string | null;
  refused: boolean;
}): string | null {
  if (!input.refused && canManageAdministration(input.workspaceRole)) return null;
  return administrationRefusal({
    workspaceRole: input.workspaceRole,
    ownerName: input.ownerName,
    destination: ANALYTICS_DESTINATION,
  });
}

/* ── Show all ──────────────────────────────────────────────────────────── */

export const WARNING_ROWS = 5;
export const RECORDED_ROWS = 20;
export const DEVICE_ROWS = 10;

/** The first rows of a list and the one button that opens the rest; `null` when nothing is hidden. */
export function limitRows<T>(
  rows: T[],
  limit: number,
  expanded: boolean,
): { rows: T[]; toggle: { label: string; expanded: boolean } | null } {
  if (rows.length <= limit) return { rows, toggle: null };
  return {
    rows: expanded ? rows : rows.slice(0, limit),
    toggle: { label: expanded ? `Show ${limit}` : `Show all ${rows.length}`, expanded },
  };
}

/* ── The figure band ───────────────────────────────────────────────────── */

export type AnalyticsFigure = { label: string; value: string };

export const FIGURE_NOTE = "Idle time is beside the tracked time, not in it. Running Timers count up to now.";

function formatPercent(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "-";
  return `${Math.round(value)}%`;
}

/** Five figures, each from its own read; a read that is missing leaves "-", never 0. */
export function composeFigureBand(
  productivity: AnalyticsProductivityInput | null | undefined,
  coverage: AnalyticsCoverageInput | null | undefined,
): AnalyticsFigure[] {
  const sum = (pick: (row: AnalyticsProductivityInput["byUser"][number]) => number) =>
    (productivity?.byUser ?? []).reduce((total, row) => total + pick(row), 0);
  const fromTime = (value: () => string) => (productivity ? value() : "-");
  return [
    { label: "Tracked", value: fromTime(() => formatHours(sum((row) => row.totalSeconds))) },
    { label: "Idle", value: fromTime(() => formatHours(sum((row) => row.idleSeconds))) },
    { label: "Time Entries", value: fromTime(() => formatCount(sum((row) => row.entriesCount))) },
    {
      label: "Members",
      value: fromTime(() => String((productivity?.byUser ?? []).filter((row) => row.totalSeconds > 0).length)),
    },
    { label: "Capture coverage", value: coverage ? formatPercent(coverage.summary.coveragePercent) : "-" },
  ];
}

/* ── Warnings ──────────────────────────────────────────────────────────── */

export type AnalyticsWarnings = {
  empty: boolean;
  stalledDevices: Array<{ id: string; name: string; who: string; lastSeen: string }>;
  mostlyIdle: Array<{ id: string; who: string; tracked: string; idle: string }>;
  runningWithoutCaptures: Array<{ id: string; who: string; started: string }>;
};

function toIsoOrNull(value: string | Date | null): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}

export function composeWarnings(alerts: AnalyticsAlertsInput, now: Date): AnalyticsWarnings {
  const stalledDevices = alerts.stalledDevices.map((row) => ({
    id: row.deviceId,
    name: row.deviceName,
    who: row.userName,
    lastSeen: formatRelativeTime(toIsoOrNull(row.lastSeenAt), now),
  }));
  const mostlyIdle = alerts.highIdleUsers.map((row) => ({
    id: row.userId,
    who: row.userName,
    tracked: formatHours(row.totalSeconds),
    idle: `${Math.round(row.idleRatio)}%`,
  }));
  const runningWithoutCaptures = alerts.runningWithoutScreenshots.map((row) => ({
    id: row.entryId,
    who: row.userName,
    started: formatRelativeTime(toIsoOrNull(row.startedAt), now),
  }));
  return {
    empty: stalledDevices.length === 0 && mostlyIdle.length === 0 && runningWithoutCaptures.length === 0,
    stalledDevices,
    mostlyIdle,
    runningWithoutCaptures,
  };
}

/* ── Hours per day ─────────────────────────────────────────────────────── */

/** Past this many days the bars are weeks. */
export const DAILY_BARS_MAX_DAYS = 45;

export type HoursPoint = { key: string; label: string; hours: number; tracked: string };

export type HoursChart = {
  empty: boolean;
  grain: "day" | "week";
  points: HoursPoint[];
  table: StatsChartTable;
};

/** A day later, on the calendar: a day is not always 24 hours. */
function nextDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
}

function dayLabel(date: Date): string {
  return `${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

/** Every day of the Range, those without time as 0; weeks (from Monday) past 45 days. */
export function composeHoursChart(dailyTrend: AnalyticsProductivityInput["dailyTrend"], range: AnalyticsRange): HoursChart {
  const seconds = new Map(dailyTrend.map((row) => [row.date, row.totalSeconds]));
  const days: Array<{ date: Date; seconds: number }> = [];
  const last = dateToDay(range.end);
  for (let date = new Date(range.start.getFullYear(), range.start.getMonth(), range.start.getDate()); ; date = nextDay(date)) {
    days.push({ date, seconds: seconds.get(dateToDay(date)) ?? 0 });
    if (dateToDay(date) >= last) break;
  }
  const weekly = days.length > DAILY_BARS_MAX_DAYS;
  const buckets = new Map<string, { label: string; seconds: number }>();
  for (const day of days) {
    // The Monday this day belongs to; the first and last week keep only the days inside the Range.
    const monday = new Date(day.date.getFullYear(), day.date.getMonth(), day.date.getDate() - ((day.date.getDay() + 6) % 7));
    const key = weekly ? dateToDay(monday) : dateToDay(day.date);
    const label = weekly ? `Week of ${dayLabel(monday)}` : dayLabel(day.date);
    const bucket = buckets.get(key) ?? { label, seconds: 0 };
    bucket.seconds += day.seconds;
    buckets.set(key, bucket);
  }
  const points = [...buckets.entries()].map(([key, bucket]) => ({
    key,
    label: bucket.label,
    hours: bucket.seconds / 3600,
    tracked: formatHours(bucket.seconds),
  }));
  return {
    empty: points.every((point) => point.hours === 0),
    grain: weekly ? "week" : "day",
    points,
    table: { columns: [weekly ? "Week" : "Day", "Tracked"], rows: points.map((point) => [point.label, point.tracked]) },
  };
}

/* ── Recorded time ─────────────────────────────────────────────────────── */

export function memberTimeHref(userId: string): string {
  return `${timeTabHref("entries")}${writeTimeFilters("", { ...TIME_FILTERS_DEFAULT, range: "all", member: userId })}`;
}

/** Activity on that Member, over the Range's own days. */
export function memberActivityHref(userId: string, range: AnalyticsRange): string {
  const filters = {
    ...ACTIVITY_FILTERS_DEFAULT,
    range: "custom" as const,
    from: dateToDay(range.start),
    to: dateToDay(range.end),
    member: userId,
  };
  return `${activityTabHref("register")}${writeActivityFilters("", filters)}`;
}

export type RecordedTime = {
  empty: boolean;
  counts: Record<AnalyticsTab, number>;
  members: Array<{ id: string; name: string; href: string; tracked: string; idle: string; entries: string }>;
  projects: Array<{ id: string; name: string; client: string | null; href: string; tracked: string; entries: string }>;
  tasks: Array<{
    id: string;
    name: string;
    project: string | null;
    client: string | null;
    href: string | null;
    tracked: string;
  }>;
};

export function composeRecordedTime(productivity: AnalyticsProductivityInput): RecordedTime {
  const members = productivity.byUser.map((row) => ({
    id: row.userId,
    name: row.userName,
    href: memberTimeHref(row.userId),
    tracked: formatHours(row.totalSeconds),
    idle: formatHours(row.idleSeconds),
    entries: String(row.entriesCount),
  }));
  const projects = productivity.byProject.map((row) => ({
    id: row.crmProjectId,
    name: row.projectName,
    client: row.clientName,
    href: projectHref(row.crmProjectId),
    tracked: formatHours(row.totalSeconds),
    entries: String(row.entriesCount),
  }));
  const tasks = productivity.byTask.map((row, index) => ({
    id: row.taskId ?? `task-${index}`,
    name: row.taskName,
    project: row.projectName,
    client: row.clientName,
    href: row.crmProjectId ? projectTasksHref(row.crmProjectId) : null,
    tracked: formatHours(row.totalSeconds),
  }));
  return {
    empty: members.length === 0 && projects.length === 0 && tasks.length === 0,
    counts: { members: members.length, projects: projects.length, tasks: tasks.length },
    members,
    projects,
    tasks,
  };
}

/* ── Captures ──────────────────────────────────────────────────────────── */

export type AnalyticsCaptures = {
  /** Nobody tracked time and nothing was taken: one line says it for the whole card. */
  empty: boolean;
  /** Nothing was taken, so there is no hour to chart. */
  noneTaken: boolean;
  figures: AnalyticsFigure[];
  line: string;
  rows: Array<{ id: string; name: string; href: string; tracked: string; captures: string; coverage: string }>;
};

/** What a capture is and where Expected comes from, said before any number. */
export function captureLine(everyMinutes: number | null | undefined): string {
  const what = "Screenshots the desktop app takes while a Timer runs.";
  if (typeof everyMinutes !== "number") return `${what} They are off in the Tracking Policy.`;
  const interval = everyMinutes === 1 ? "minute" : `${everyMinutes} minutes`;
  return `${what} Expected: one per ${interval} of tracked time, as the Tracking Policy asks.`;
}

/** Members in alphabetical order, as the server sends them: nobody is ranked. */
export function composeCaptures(coverage: AnalyticsCoverageInput, range: AnalyticsRange): AnalyticsCaptures {
  const summary = coverage.summary;
  return {
    empty: coverage.byUser.length === 0,
    noneTaken: summary.totalScreenshots === 0,
    figures: [
      { label: "Taken", value: formatCount(summary.totalScreenshots) },
      { label: "Expected", value: formatCount(summary.expectedScreenshots) },
      { label: "Time Entries without any", value: formatCount(summary.entriesWithoutScreenshots) },
      { label: "Deleted", value: formatCount(summary.deletedScreenshots) },
    ],
    line: captureLine(summary.captureEveryMinutes),
    rows: coverage.byUser.map((row) => ({
      id: row.userId,
      name: row.userName,
      href: memberActivityHref(row.userId, range),
      tracked: formatHours(row.trackedSeconds),
      captures: `${formatCount(row.screenshotCount)} of ${formatCount(row.expectedScreenshots)}`,
      coverage: formatPercent(row.coveragePct),
    })),
  };
}

export type HourPoint = { hour: number; label: string; count: number };

/** The 24 hours of the day, 00:00 to 23:00, those without a capture as 0. */
export function composeHourly(screenshots: AnalyticsScreenshotsInput): {
  empty: boolean;
  points: HourPoint[];
  table: StatsChartTable;
} {
  const counts = new Map(screenshots.hourlyDistribution.map((row) => [row.hour, row.count]));
  const points = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    label: `${String(hour).padStart(2, "0")}:00`,
    count: counts.get(hour) ?? 0,
  }));
  return {
    empty: points.every((point) => point.count === 0),
    points,
    table: { columns: ["Hour", "Captures"], rows: points.map((point) => [point.label, formatCount(point.count)]) },
  };
}

/* ── Devices ───────────────────────────────────────────────────────────── */

export type AnalyticsDeviceRow = {
  id: string;
  name: string;
  who: string;
  platform: string;
  lastSeen: string;
  status: "Active" | "Revoked";
};

function platformLabel(device: AnalyticsDeviceInput): string {
  const parts = [device.os?.trim(), device.clientVersion?.trim()].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(" · ") : "-";
}

export function composeDevices(devices: AnalyticsDeviceInput[], now: Date): AnalyticsDeviceRow[] {
  return devices.map((device) => ({
    id: device.id,
    name: device.name,
    who: device.userName,
    platform: platformLabel(device),
    lastSeen: formatRelativeTime(toIsoOrNull(device.lastSeenAt), now),
    status: device.revokedAt ? "Revoked" : "Active",
  }));
}

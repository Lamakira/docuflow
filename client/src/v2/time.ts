/**
 * Time Tracking destination (#190), deepened with Time stats and the
 * Projects & Tasks manager (#214).
 * Novelty: adding or removing a Time Entry has an enter/exit bridge
 * (preventing a jarring change). One amber stays on the running Timer chip.
 * Changing the Time stats period crossfades on opacity only.
 * Do not animate: ticking elapsed seconds, a timesheet-like matrix,
 * by-Project histogram bars as a parade, Daily Update field focus.
 *
 * The Projects & Tasks tab is composed by `tasks.ts` — the Task protocol is
 * shared with the Dossier, so it does not live in this destination's module.
 */

import { formatElapsedClock, timeTabHref, TIME_TAB_IDS, type TimeTabId } from "./presentation";
import { formatHours, memberName } from "./today";

export type TimeEntryRowInput = {
  id: string;
  startTime: Date | string;
  duration: number | null;
  status: string;
  userId: string;
  crmProjectId: string;
  taskId?: string | null;
  description?: string | null;
  user?: { firstName?: string | null; lastName?: string | null; email?: string | null };
  crmProject?: {
    project?: { name?: string | null } | null;
    client?: { name?: string | null } | null;
  };
  task?: { name?: string | null } | null;
};

export type TimeTrackingInput = {
  now: Date;
  workspaceName: string;
  currentUserId: string;
  isAdmin: boolean;
  isRunning: boolean;
  displayDuration: number;
  activeEntryId: string | null;
  entries: TimeEntryRowInput[];
  workdaySeconds: number;
};

export type TimeTrackingRow = {
  id: string;
  when: string;
  who: string;
  project: string;
  task: string;
  duration: string;
  status: string;
  running: boolean;
  holdsAmber: false;
  canDelete: boolean;
};

export type TimeTrackingModel = {
  subhead: string;
  workdayHours: string;
  empty: boolean;
  emptyCopy: string;
  rows: TimeTrackingRow[];
  pagePrimary: "case-ink";
};

export type TimeEntriesFilter = {
  startDate?: Date | null;
  endDate?: Date | null;
  crmProjectId?: string | null;
  status?: string | null;
  userId?: string | null;
};

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

function parseDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatClock(value: Date): string {
  return `${value.getHours().toString().padStart(2, "0")}:${value.getMinutes().toString().padStart(2, "0")}`;
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function formatWhen(startTime: Date | string, now: Date): string {
  const value = parseDate(startTime);
  if (!value) return "";
  if (sameDay(value, now)) return formatClock(value);
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (sameDay(value, yesterday)) return "YDA";
  return `${value.getDate()} ${MONTHS[value.getMonth()]}`;
}

function projectLabel(entry: TimeEntryRowInput): string {
  const projectName = entry.crmProject?.project?.name?.trim() || "Untitled Project";
  const clientName = entry.crmProject?.client?.name?.trim();
  return clientName ? `${clientName} · ${projectName}` : projectName;
}

function taskLabel(entry: TimeEntryRowInput): string {
  return entry.task?.name?.trim() || entry.description?.trim() || "—";
}

export function timeEntriesPath(filters: TimeEntriesFilter = {}): string {
  const params = new URLSearchParams();
  if (filters.startDate) params.set("startDate", filters.startDate.toISOString());
  if (filters.endDate) params.set("endDate", filters.endDate.toISOString());
  if (filters.crmProjectId) params.set("crmProjectId", filters.crmProjectId);
  if (filters.status) params.set("status", filters.status);
  if (filters.userId) params.set("userId", filters.userId);
  const query = params.toString();
  return query ? `/api/time-tracking/entries?${query}` : "/api/time-tracking/entries";
}

export function timeStatsPath(filters: Omit<TimeEntriesFilter, "status"> = {}): string {
  const params = new URLSearchParams();
  if (filters.startDate) params.set("startDate", filters.startDate.toISOString());
  if (filters.endDate) params.set("endDate", filters.endDate.toISOString());
  if (filters.crmProjectId) params.set("crmProjectId", filters.crmProjectId);
  if (filters.userId) params.set("userId", filters.userId);
  const query = params.toString();
  return query ? `/api/time-tracking/stats?${query}` : "/api/time-tracking/stats";
}

export function composeTimeTracking(input: TimeTrackingInput): TimeTrackingModel {
  const rows = input.entries.map((entry) => {
    const running = entry.status === "running" || entry.id === input.activeEntryId;
    const seconds =
      running && entry.id === input.activeEntryId ? input.displayDuration : entry.duration || 0;
    const canDelete =
      entry.status === "stopped" && (input.isAdmin || entry.userId === input.currentUserId);
    return {
      id: entry.id,
      when: formatWhen(entry.startTime, input.now),
      who: entry.user ? memberName(entry.user) : "Member",
      project: projectLabel(entry),
      task: taskLabel(entry),
      duration: formatElapsedClock(seconds),
      status: entry.status.replace(/_/g, " ").toUpperCase(),
      running,
      holdsAmber: false as const,
      canDelete,
    };
  });
  const empty = rows.length === 0;
  return {
    subhead: `Time Entries in ${input.workspaceName}.`,
    workdayHours: formatHours(input.workdaySeconds),
    empty,
    emptyCopy: empty ? "No Time Entry in this Workspace for these filters." : "",
    rows,
    pagePrimary: "case-ink",
  };
}

/* ---------------------------------------------------------------------------
 * Time stats (#214) — the v1 `/time-tracking/dashboard` figures, composed from
 * `/api/time-tracking/stats`. CONTEXT.md: Activity Evidence is never converted
 * into productivity scores or member rankings, so the v1 "Productivity %" KPI
 * does not come across, and the by-Member breakdown is alphabetical with no
 * share bar to rank people against each other.
 * ------------------------------------------------------------------------ */

export const TIME_PERIODS = ["today", "week", "month", "30d", "all"] as const;

export type TimePeriod = (typeof TIME_PERIODS)[number];

const PERIOD_LABEL: Record<TimePeriod, string> = {
  today: "Today",
  week: "This week",
  month: "This month",
  "30d": "Last 30 days",
  all: "All time",
};

export function timePeriodLabel(period: TimePeriod): string {
  return PERIOD_LABEL[period];
}

/**
 * A span of tracked work, at the resolution the v1 dashboard reported it.
 * `formatHours` stays the Workday chip's format; a stats figure needs minutes,
 * because an average Time Entry is usually shorter than an hour and "0.8 h"
 * hides what "45m" says plainly.
 */
export function formatSpan(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

/** One local day boundary, shared by every surface that filters on a date. */
export function startOfDayLocal(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

export function endOfDayLocal(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate(), 23, 59, 59, 999);
}

/** Weeks start on Monday, as the v1 dashboard and the Workday grouping do. */
export function timePeriodRange(
  period: TimePeriod,
  now: Date,
): { startDate: Date | null; endDate: Date | null } {
  if (period === "all") return { startDate: null, endDate: null };
  if (period === "today") return { startDate: startOfDayLocal(now), endDate: endOfDayLocal(now) };
  if (period === "week") {
    const start = startOfDayLocal(now);
    const weekday = start.getDay();
    start.setDate(start.getDate() - (weekday === 0 ? 6 : weekday - 1));
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    return { startDate: start, endDate: endOfDayLocal(end) };
  }
  if (period === "month") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { startDate: start, endDate: endOfDayLocal(end) };
  }
  const start = startOfDayLocal(now);
  start.setDate(start.getDate() - 29);
  return { startDate: start, endDate: endOfDayLocal(now) };
}

export type TimeStatsResponse = {
  totalDuration: number;
  totalIdleTime: number;
  entriesCount: number;
  screenshotCount: number;
  byProject: Array<{ crmProjectId: string; projectName: string; totalDuration: number }>;
  byUser: Array<{ userId: string; userName: string; totalDuration: number }>;
};

export type TimeStatsInput = {
  period: TimePeriod;
  workspaceName: string;
  /** Only an Administrator's stats span the Workspace; a Member sees their own. */
  canSeeEveryone: boolean;
  stats: TimeStatsResponse | null;
};

export type TimeStatFigure = { label: string; value: string; meta: string };

export type TimeStatsBreakdownRow = {
  id: string;
  name: string;
  hours: string;
  /** Share of the period, for Projects only — people are not ranked. */
  share: number | null;
};

export type TimeStatsBreakdown = {
  rows: TimeStatsBreakdownRow[];
  empty: boolean;
  emptyCopy: string;
};

export type TimeStatsModel = {
  periodLabel: string;
  subhead: string;
  figures: TimeStatFigure[];
  showMembers: boolean;
  byProject: TimeStatsBreakdown;
  byMember: TimeStatsBreakdown;
};

export function composeTimeStats(input: TimeStatsInput): TimeStatsModel {
  const periodLabel = PERIOD_LABEL[input.period];
  const lower = periodLabel.toLowerCase();
  const stats = input.stats;
  const tracked = Math.max(0, stats?.totalDuration ?? 0);
  const idle = Math.max(0, stats?.totalIdleTime ?? 0);
  const entries = Math.max(0, stats?.entriesCount ?? 0);
  const captures = Math.max(0, stats?.screenshotCount ?? 0);
  const average = entries > 0 ? Math.round(tracked / entries) : 0;

  const figures: TimeStatFigure[] = [
    { label: "TRACKED", value: formatSpan(tracked), meta: "Active time, idle excluded" },
    { label: "TIME ENTRIES", value: String(entries), meta: "Recorded intervals" },
    { label: "AVERAGE ENTRY", value: formatSpan(average), meta: "Per Time Entry" },
    { label: "IDLE", value: formatSpan(idle), meta: "Detected idle time" },
    { label: "ACTIVITY EVIDENCE", value: String(captures), meta: "Captures in this period" },
  ];

  const projectRows = [...(stats?.byProject ?? [])]
    .sort((a, b) => b.totalDuration - a.totalDuration)
    .map((row) => ({
      id: row.crmProjectId,
      name: row.projectName?.trim() || "Untitled Project",
      hours: formatSpan(row.totalDuration),
      share: tracked > 0 ? Math.round((row.totalDuration / tracked) * 100) : 0,
    }));

  const memberRows = input.canSeeEveryone
    ? [...(stats?.byUser ?? [])]
        .map((row) => ({
          id: row.userId,
          name: row.userName?.trim() || "Member",
          hours: formatSpan(row.totalDuration),
          share: null,
        }))
        .sort((a, b) => a.name.localeCompare(b.name))
    : [];

  return {
    periodLabel,
    subhead: input.canSeeEveryone
      ? `Workday totals across ${input.workspaceName}, ${lower}.`
      : `Your Workday totals in ${input.workspaceName}, ${lower}.`,
    figures,
    showMembers: input.canSeeEveryone,
    byProject: {
      rows: projectRows,
      empty: projectRows.length === 0,
      emptyCopy: `No Time Entry on a Project ${lower}.`,
    },
    byMember: {
      rows: memberRows,
      empty: memberRows.length === 0,
      emptyCopy: `No Time Entry by a Member ${lower}.`,
    },
  };
}

const TIME_TAB_LABEL: Record<TimeTabId, string> = {
  entries: "Time Entries",
  stats: "Time stats",
  projects: "Projects & Tasks",
};

export type TimeTab = { id: TimeTabId; label: string; href: string; active: boolean };

export function timeTabs(active: TimeTabId): TimeTab[] {
  return TIME_TAB_IDS.map((id) => ({
    id,
    label: TIME_TAB_LABEL[id],
    href: timeTabHref(id),
    active: id === active,
  }));
}

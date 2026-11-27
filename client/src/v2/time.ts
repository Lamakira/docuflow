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

import { emptyKindOf, emptyModelOf, type EmptyModel } from "./emptyState";
import { formatElapsedClock, timeTabHref, TIME_TAB_IDS, type TimeTabId } from "./presentation";
import { formatHours, memberName } from "./today";
import { MONTHS } from "./dates";
import { DEFAULT_REGISTER_PAGE_SIZE, readPage, readPageSize, writePaging } from "./paging";
import { fullProjectName, type ProjectTaskProject } from "./tasks";
import { isDeliveryProject, projectHasOpportunity } from "@shared/projectLifecycle";
import { STALE_THRESHOLD_MS } from "@shared/timePortion";

export type TimeEntryRowInput = {
  id: string;
  startTime: Date | string;
  endTime?: Date | string | null;
  lastActivityAt?: Date | string | null;
  duration: number | null;
  /** The seconds of it inside the register's period, as the server cut them. */
  secondsInPeriod?: number;
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
  currentUserId: string;
  isAdmin: boolean;
  isRunning: boolean;
  displayDuration: number;
  activeEntryId: string | null;
  entries: TimeEntryRowInput[];
  workdaySeconds: number;
  /** Simultaneous Time in the reader's day, from the same stats; 0 or omitted when none. */
  simultaneousSeconds?: number;
  /** The clock the running rows tick on; `now` when omitted. */
  nowMs?: number;
  /** Seconds since the register was read, for the running row's part of the period. */
  liveSeconds?: number;
  /** Where the register's period starts; null or omitted for all time. */
  periodStart?: Date | null;
  /** The Range filter; the register opens on `today`. Omitted reads as the whole Workspace. */
  range?: "today" | "week" | "all";
  /** Whether the Project, Status or Member filter narrows the register. */
  facetsActive?: boolean;
  /** Those filters in plain words, for the empty state. */
  facetLabels?: string[];
  /** Whether the reader has any Time Entry in any period; `null` while unknown. */
  everRecorded?: boolean | null;
  /** Whether the Workspace has any Project; omitted reads as yes. */
  hasProjects?: boolean;
  /** Whether the reader may create a Project (not read-only). */
  canCreateProject?: boolean;
};

export type TimeTrackingRow = {
  id: string;
  when: string;
  who: string;
  project: string;
  task: string;
  duration: string;
  /** "2h 10m in this period", when only part of the entry is inside it. */
  inPeriod: string | null;
  status: string;
  running: boolean;
  holdsAmber: false;
  canDelete: boolean;
};

export type TimeTrackingModel = {
  /** The reader's own day, whatever the filters: "You today 2.5 h". */
  workdayHours: string;
  empty: boolean;
  /** Why the register shows nothing (#325); null while it has rows. */
  emptyState: EmptyModel | null;
  /** The designed state's one action, only for a reader who may take it. */
  emptyAction: { label: string; href: string } | null;
  /** Under the Timer when the Workspace has no Project to track against. */
  timerHint: { copy: string; linkLabel: string; href: string | null } | null;
  rows: TimeTrackingRow[];
  pagePrimary: "case-ink";
};

export type TimeEntriesFilter = {
  startDate?: Date | null;
  endDate?: Date | null;
  crmProjectId?: string | null;
  status?: string | null;
  userId?: string | null;
  /** Newest first, cut to this many; `1` answers "is there any" without loading the list. */
  limit?: number | null;
  /** With a page the server answers one page, the total and the period's totals. */
  page?: number | null;
  pageSize?: number | null;
};

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

function dayNumber(value: Date): number {
  return Math.round(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()) / 86_400_000);
}

/** Local time: "09:00 - 12:30" today, the day before it otherwise, and how many days later it ended. */
export function formatEntryWhen(
  entry: Pick<TimeEntryRowInput, "startTime" | "endTime" | "lastActivityAt" | "status">,
  now: Date,
): string {
  const start = parseDate(entry.startTime);
  if (!start) return "";
  let day = "";
  if (!sameDay(start, now)) {
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    if (sameDay(start, yesterday)) day = "Yesterday, ";
    else {
      const year = start.getFullYear() === now.getFullYear() ? "" : ` ${start.getFullYear()}`;
      day = `${start.getDate()} ${MONTHS[start.getMonth()]}${year}, `;
    }
  }
  if (entry.status === "running") return `${day}${formatClock(start)} - now`;
  // A paused entry holds time up to where it was paused.
  const end = parseDate(entry.endTime) ?? (entry.status === "paused" ? parseDate(entry.lastActivityAt) : null);
  if (!end) return `${day}${formatClock(start)}`;
  const days = dayNumber(end) - dayNumber(start);
  const later = days > 0 ? ` +${days} ${days === 1 ? "day" : "days"}` : "";
  return `${day}${formatClock(start)} - ${formatClock(end)}${later}`;
}

/** The part of an entry inside the period, when it is only a part. The running one ticks on from the read. */
function inPeriodLabel(entry: TimeEntryRowInput, input: TimeTrackingInput): string | null {
  if (entry.secondsInPeriod === undefined) return null;
  const running = entry.status === "running";
  const start = parseDate(entry.startTime);
  const partial = running
    ? Boolean(input.periodStart && start && start < input.periodStart)
    : entry.secondsInPeriod < (entry.duration ?? 0);
  if (!partial) return null;
  return `${formatSpan(entry.secondsInPeriod + (running ? (input.liveSeconds ?? 0) : 0))} in this period`;
}

/**
 * The seconds a figure misses since it was read, while the Timer runs; it
 * already holds the rest. Never more than the entry holds: a Timer started
 * elsewhere may be younger than the read.
 */
export function secondsSinceRead(readAt: number, nowMs: number, running: boolean, entrySeconds: number): number {
  if (!running || !readAt) return 0;
  return Math.min(Math.max(0, Math.floor((nowMs - readAt) / 1000)), Math.max(0, entrySeconds));
}

/* ---------------------------------------------------------------------------
 * Which Projects take time (F71).
 * ------------------------------------------------------------------------ */

type TimerProject = ProjectTaskProject & {
  isDocumentationOnly?: number | null;
  projectType?: string | null;
  status?: string | null;
};

/** Time goes on delivery work; the server refuses a sale and a documentation-only Project. */
export function isTimerProject(project: TimerProject): boolean {
  return isDeliveryProject(project) && !project.isDocumentationOnly;
}

/** The Projects the Timer and Projects & Tasks offer, by "Client · Project". */
export function timerProjects<T extends TimerProject>(projects: T[]): T[] {
  return projects
    .filter(isTimerProject)
    .sort((a, b) => fullProjectName(a).localeCompare(fullProjectName(b)));
}

export type TimeProjectOption = { id: string; label: string; meta: string | null };

export function timerProjectOptions(projects: TimerProject[]): TimeProjectOption[] {
  return timerProjects(projects).map((project) => ({ id: project.id, label: fullProjectName(project), meta: null }));
}

/** Every Project that may hold entries: time already on a sale stays findable. */
export function filterProjectOptions(projects: TimerProject[]): TimeProjectOption[] {
  return projects
    .map((project) => ({
      id: project.id,
      label: fullProjectName(project),
      meta: projectHasOpportunity(project) && !isDeliveryProject(project) ? "Opportunity" : null,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function projectTasksHref(crmProjectId: string): string {
  return `${timeTabHref("projects")}?${new URLSearchParams({ project: crmProjectId })}`;
}

/* ---------------------------------------------------------------------------
 * The filters, in the address (F73). Defaults are left out; an unknown value
 * reads as its default.
 * ------------------------------------------------------------------------ */

export type TimeRange = "today" | "week" | "all";

export type TimeFilters = {
  range: TimeRange;
  project: string;
  status: string;
  member: string;
  page: number;
  pageSize: number;
};

export const TIME_RANGE_OPTIONS: Array<{ value: TimeRange; label: string }> = [
  { value: "today", label: "Today" },
  { value: "week", label: "This week" },
  { value: "all", label: "All" },
];

export const TIME_STATUS_OPTIONS = [
  { value: "all", label: "All" },
  { value: "running", label: "Running" },
  { value: "paused", label: "Paused" },
  { value: "stopped", label: "Stopped" },
];

export const TIME_FILTERS_DEFAULT: TimeFilters = {
  range: "today",
  project: "all",
  status: "all",
  member: "all",
  page: 1,
  pageSize: DEFAULT_REGISTER_PAGE_SIZE,
};

function queryOf(params: URLSearchParams): string {
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function readTimeFilters(search: string): TimeFilters {
  const params = new URLSearchParams(search);
  const known = <T extends string>(name: string, options: Array<{ value: T }>, fallback: T): T =>
    options.find((option) => option.value === params.get(name))?.value ?? fallback;
  return {
    range: known("range", TIME_RANGE_OPTIONS, TIME_FILTERS_DEFAULT.range),
    project: params.get("project")?.trim() || "all",
    status: known("status", TIME_STATUS_OPTIONS, "all"),
    member: params.get("member")?.trim() || "all",
    page: readPage(params),
    pageSize: readPageSize(params),
  };
}

export function writeTimeFilters(search: string, filters: TimeFilters): string {
  const params = new URLSearchParams(search);
  for (const name of ["range", "project", "status", "member"] as const) {
    if (filters[name] !== TIME_FILTERS_DEFAULT[name]) params.set(name, filters[name]);
    else params.delete(name);
  }
  writePaging(params, filters.page, filters.pageSize);
  return queryOf(params);
}

/** A Project or Member id the loaded list does not hold reads as All; an unknown list (`null`) keeps it. */
export function knownFilterId(id: string, known: Array<{ id: string }> | null): string {
  if (id === "all" || known === null) return id;
  return known.some((row) => row.id === id) ? id : "all";
}

export function readTimePeriod(search: string): TimePeriod {
  const value = new URLSearchParams(search).get("period");
  return (TIME_PERIODS as readonly string[]).includes(value ?? "") ? (value as TimePeriod) : "week";
}

export function writeTimePeriod(search: string, period: TimePeriod): string {
  const params = new URLSearchParams(search);
  if (period === "week") params.delete("period");
  else params.set("period", period);
  return queryOf(params);
}

export function readChosenProject(search: string): string | null {
  return new URLSearchParams(search).get("project")?.trim() || null;
}

export function writeChosenProject(search: string, id: string): string {
  const params = new URLSearchParams(search);
  params.set("project", id);
  return queryOf(params);
}

const RANGE_WORDS: Record<TimeRange, string> = { today: "today", week: "this week", all: "in all" };

/** What the register's foot says after its count: "3h 20m this week". */
export function rangeTotalLabel(seconds: number, range: TimeRange): string {
  return `${formatSpan(seconds)} ${RANGE_WORDS[range]}`;
}

function projectLabel(entry: TimeEntryRowInput): string {
  const projectName = entry.crmProject?.project?.name?.trim() || "Untitled Project";
  const clientName = entry.crmProject?.client?.name?.trim();
  return clientName ? `${clientName} · ${projectName}` : projectName;
}

function taskLabel(entry: TimeEntryRowInput): string {
  return entry.task?.name?.trim() || entry.description?.trim() || "-";
}

export function timeEntriesPath(filters: TimeEntriesFilter = {}): string {
  const params = new URLSearchParams();
  if (filters.startDate) params.set("startDate", filters.startDate.toISOString());
  if (filters.endDate) params.set("endDate", filters.endDate.toISOString());
  if (filters.crmProjectId) params.set("crmProjectId", filters.crmProjectId);
  if (filters.status) params.set("status", filters.status);
  if (filters.userId) params.set("userId", filters.userId);
  if (filters.limit) params.set("limit", String(filters.limit));
  if (filters.page) {
    params.set("page", String(filters.page));
    params.set("pageSize", String(filters.pageSize ?? DEFAULT_REGISTER_PAGE_SIZE));
  }
  const query = params.toString();
  return query ? `/api/time-tracking/entries?${query}` : "/api/time-tracking/entries";
}

/** The stats of a period, the running or paused Time Entry in them (F67). */
export function timeStatsPath(filters: Omit<TimeEntriesFilter, "status" | "limit" | "page" | "pageSize"> = {}): string {
  const params = new URLSearchParams();
  if (filters.startDate) params.set("startDate", filters.startDate.toISOString());
  if (filters.endDate) params.set("endDate", filters.endDate.toISOString());
  if (filters.crmProjectId) params.set("crmProjectId", filters.crmProjectId);
  if (filters.userId) params.set("userId", filters.userId);
  params.set("includeActive", "1");
  return `/api/time-tracking/stats?${params.toString()}`;
}

/** The Range one step wider than this one; `null` when it is already the widest. */
export function widerTimeRange(range: "today" | "week" | "all"): "week" | "all" | null {
  if (range === "today") return "week";
  if (range === "week") return "all";
  return null;
}

/** The label of the action that widens the Range: "Show this week", "Show all time". */
function widenTimeLabel(range: "today" | "week" | "all"): string | null {
  const wider = widerTimeRange(range);
  if (!wider) return null;
  const label = timePeriodLabel(wider);
  return `Show ${label.charAt(0).toLowerCase()}${label.slice(1)}`;
}

/**
 * A running row the Timer does not show (another of the reader's Simultaneous
 * Timers, another Member's) still ticks: its seconds since its last sign of
 * life, as the server counts them, and none once it has gone silent.
 */
function liveSecondsOf(entry: Pick<TimeEntryRowInput, "status" | "lastActivityAt">, nowMs: number): number {
  if (entry.status !== "running") return 0;
  const last = parseDate(entry.lastActivityAt);
  if (!last) return 0;
  const silentMs = nowMs - last.getTime();
  return silentMs > STALE_THRESHOLD_MS ? 0 : Math.max(0, Math.floor(silentMs / 1000));
}

export function composeTimeTracking(input: TimeTrackingInput): TimeTrackingModel {
  const rows = input.entries.map((entry) => {
    const running = entry.status === "running" || entry.id === input.activeEntryId;
    const seconds =
      running && entry.id === input.activeEntryId
        ? input.displayDuration
        : (entry.duration || 0) + liveSecondsOf(entry, input.nowMs ?? input.now.getTime());
    const canDelete =
      entry.status === "stopped" && (input.isAdmin || entry.userId === input.currentUserId);
    return {
      id: entry.id,
      when: formatEntryWhen(entry, input.now),
      who: entry.user ? memberName(entry.user) : "Member",
      project: projectLabel(entry),
      task: taskLabel(entry),
      duration: formatElapsedClock(seconds),
      inPeriod: inPeriodLabel(entry, input),
      status: entry.status.replace(/_/g, " ").toUpperCase(),
      running,
      holdsAmber: false as const,
      canDelete,
    };
  });
  const empty = rows.length === 0;
  // A short Range cannot claim the Workspace has none: rows may sit outside it, so the Range state names the window.
  const hasProjects = input.hasProjects !== false;
  const newProject = { label: "New Project", href: "/projects?new=1" };
  const window = input.range === "today" ? "today" : input.range === "week" ? "this week" : null;
  const widenLabel = input.range ? widenTimeLabel(input.range) : null;
  return {
    workdayHours:
      (input.simultaneousSeconds ?? 0) > 0
        ? workedTimeLabel(input.workdaySeconds, input.simultaneousSeconds ?? 0)
        : `You today ${formatHours(input.workdaySeconds)}`,
    empty,
    emptyState: emptyModelOf(
      emptyKindOf(empty, Boolean(input.facetsActive), window !== null, input.everRecorded ?? null),
      "Time Entries",
      {
        title: "Track your first Time Entry",
        copy: hasProjects
          ? "Time Entries are the intervals worked on a Project. Choose a Project and Task in the Timer above, then press Start."
          : "A Time Entry is logged against a Task in a Project, so a Project has to exist first. Create one, then start the Timer.",
      },
      { window: window ?? "in this Workspace", widenLabel },
      { filters: input.facetLabels, window: window ?? undefined },
    ),
    emptyAction: !hasProjects && input.canCreateProject ? newProject : null,
    timerHint: hasProjects
      ? null
      : {
          copy: "Create a Project to start tracking.",
          linkLabel: "Create a Project",
          href: input.canCreateProject ? newProject.href : null,
        },
    rows,
    pagePrimary: "case-ink",
  };
}

/* ---------------------------------------------------------------------------
 * Time stats (#214) — the v1 `/time-tracking/dashboard` figures, composed from
 * `/api/time-tracking/stats`. GLOSSARY.md: Activity Evidence is never converted
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

/**
 * The reader's day as ADR-0031 words it: Worked Time (each hour once) and, when
 * two or more Timers ran at once, the Simultaneous Time inside it.
 */
export function workedTimeLabel(workedSeconds: number, simultaneousSeconds: number): string {
  const worked = `Worked time ${formatSpan(workedSeconds)}`;
  return simultaneousSeconds > 0 ? `${worked} · ${formatSpan(simultaneousSeconds)} simultaneous` : worked;
}

export type StartChoice =
  /** Start switches at once, as with one Timer at a time (no mode sent). */
  | { kind: "switch" }
  /** Ask: `canAdd` is false at the limit, and `limitLine` says why. */
  | { kind: "ask"; canAdd: boolean; limitLine: string | null };

/**
 * Why this Timer cannot be added beside the active ones, as the server would
 * refuse it (ADR-0031): its Task already has a Timer, or a Timer without a
 * Task occupies the whole Project. Null when it can be.
 */
export function addConflictLine(
  timers: ReadonlyArray<{ crmProjectId: string; taskId: string | null }>,
  crmProjectId: string,
  taskId: string | null,
): string | null {
  if (taskId !== null && timers.some((timer) => timer.taskId === taskId)) return "A Timer already runs on this Task.";
  const sameProject = timers.filter((timer) => timer.crmProjectId === crmProjectId);
  if (taskId === null && sameProject.length > 0) return "This Project already has a Timer.";
  if (sameProject.some((timer) => timer.taskId === null)) return "A Timer without a Task already runs on this Project.";
  return null;
}

/** ADR-0031 "Starting": with the option on and a Timer active, Start asks add or switch. */
export function startChoice(input: {
  simultaneousTimers: boolean;
  maxTimers: number;
  activeCount: number;
  /** From `addConflictLine` for the Project and Task asked for. */
  conflictLine?: string | null;
}): StartChoice {
  if (!input.simultaneousTimers || input.activeCount < 1) return { kind: "switch" };
  if (input.activeCount >= input.maxTimers) {
    return { kind: "ask", canAdd: false, limitLine: `You run ${input.maxTimers} Timers. Stop one to add another.` };
  }
  if (input.conflictLine) return { kind: "ask", canAdd: false, limitLine: input.conflictLine };
  return { kind: "ask", canAdd: true, limitLine: null };
}

/** What Switch stops, named in the add-or-switch dialog. */
export function switchStopsLine(timerLabels: string[]): string {
  if (timerLabels.length === 1) return `Switch stops the Timer on ${timerLabels[0]}.`;
  return `Switch stops your ${timerLabels.length} Timers, paused ones included.`;
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
  /** Owner and Administrator stats span the Workspace; a Member sees their own. */
  canSeeEveryone: boolean;
  stats: TimeStatsResponse | null;
  /** Whether the reader has any Time Entry in any period; `null` while unknown. */
  everRecorded?: boolean | null;
  /** Whether the Workspace has any Project; omitted reads as yes. */
  hasProjects?: boolean;
  /** Whether the reader may create a Project (not read-only). */
  canCreateProject?: boolean;
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
  /** Nothing was ever recorded (#325): the designed state replaces the zero figures and compact lines. */
  neverRecorded: EmptyModel | null;
  neverRecordedAction: { label: string; href: string } | null;
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
    { label: "Tracked", value: formatSpan(tracked), meta: "Active time, idle excluded" },
    { label: "Time entries", value: String(entries), meta: "Recorded intervals" },
    { label: "Average entry", value: formatSpan(average), meta: "Per Time Entry" },
    { label: "Idle", value: formatSpan(idle), meta: "Detected idle time" },
    { label: "Activity evidence", value: String(captures), meta: "Captures in this period" },
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

  const hasProjects = input.hasProjects !== false;
  return {
    periodLabel,
    neverRecorded:
      input.everRecorded === false
        ? emptyModelOf("none", "Time Entries", {
            title: "Track your first Time Entry",
            copy: hasProjects
              ? "Time Entries are the intervals worked on a Project. Choose a Project and Task in the Timer, then press Start; the totals appear here."
              : "A Time Entry is logged against a Task in a Project, so a Project has to exist first. Create one, then start the Timer.",
          })
        : null,
    neverRecordedAction:
      input.everRecorded === false && !hasProjects && input.canCreateProject
        ? { label: "New Project", href: "/projects?new=1" }
        : null,
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

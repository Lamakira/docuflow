/**
 * Time Tracking destination (#190).
 * Novelty: adding or removing a Time Entry has an enter/exit bridge
 * (preventing a jarring change). One amber stays on the running Timer chip.
 * Do not animate: ticking elapsed seconds, a timesheet-like matrix,
 * Daily Update field focus.
 */

import { formatElapsedClock } from "./presentation";
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

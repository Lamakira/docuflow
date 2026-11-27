import type { TimeEntry, InsertTimeEntry, TimeEntryWithDetails, TimerCommand } from "@shared/schema";
import type { TimeSpan } from "@shared/timePortion";
import type { TimeExportRow } from "./timeExport";
import { applyTimerCommand, listTimerCommands, type ApplyTimerCommandInput, type ApplyTimerCommandResult } from "./commands";
import { getAllowedTimezones, upsertAllowedTimezones } from "./schedule";

export interface TimePortionOptions {
  userId?: string;
  crmProjectId?: string;
  taskIds?: string[];
  startDate?: Date;
  endDate?: Date;
  status?: string;
  /** Running and paused entries too; stopped ones only when unset. */
  includeActive?: boolean;
}

export interface TimePortionRow {
  id: string;
  userId: string;
  userName: string;
  crmProjectId: string;
  projectName: string;
  taskId: string | null;
  taskName: string | null;
  /** Inside the period. */
  seconds: number;
  idleSeconds: number;
}

/** What an Analytics report reads: the range, the zone its days and hours are in, and its filters. */
export interface AnalyticsOptions {
  startDate: Date;
  endDate: Date;
  timeZone: string;
  userId?: string;
  crmProjectId?: string;
}

export interface TimeSpanRow extends Omit<TimePortionRow, "projectName"> {
  projectName: string | null;
  clientName: string | null;
  description: string | null;
  status: string;
  provenance: string;
  span: TimeSpan;
}

export interface TimeEntryPageOptions extends TimePortionOptions {
  page: number;
  pageSize: number;
}

export interface TimeEntryPage {
  data: Array<TimeEntryWithDetails & { secondsInPeriod: number }>;
  total: number;
  /** Inside the period, over every match and not the page alone. */
  /** `duration` is Worked Time: each Member's hours once (ADR-0031). */
  totals: { duration: number; simultaneous: number; idle: number };
}

export interface TimePersistence {
  getTimeEntries(options: {
    userId?: string;
    crmProjectId?: string;
    startDate?: Date;
    endDate?: Date;
    status?: string;
    /** Newest first, cut to this many; omitted returns every match. */
    limit?: number;
  }): Promise<TimeEntryWithDetails[]>;
  getTimeEntriesPage(options: TimeEntryPageOptions): Promise<TimeEntryPage>;
  getTimePortions(options: TimePortionOptions): Promise<TimePortionRow[]>;
  getTimeEntry(id: string): Promise<TimeEntryWithDetails | undefined>;
  getTimeEntryByClientCommandId(clientCommandId: string): Promise<TimeEntry | undefined>;
  /** The latest active Timer, whichever Workspace it is in. */
  getActiveTimeEntry(userId: string): Promise<TimeEntry | undefined>;
  /** Every active Timer of the User, newest first (ADR-0031). */
  getActiveTimeEntries(userId: string): Promise<TimeEntry[]>;
  getStaleRunningEntries(staleThreshold: Date): Promise<TimeEntry[]>;
  getExpiredPausedEntries(pausedBefore: Date): Promise<TimeEntry[]>;
  createTimeEntry(entry: InsertTimeEntry): Promise<TimeEntry>;
  updateTimeEntry(id: string, data: Partial<InsertTimeEntry>): Promise<TimeEntry | undefined>;
  deleteTimeEntry(id: string): Promise<void>;
  getTimeStats(options: {
    userId?: string;
    crmProjectId?: string;
    startDate?: Date;
    endDate?: Date;
    includeActive?: boolean;
  }): Promise<{
    /** Worked Time: each Member's hours once; `byProject` once per Member (ADR-0031). */
    totalDuration: number;
    simultaneousDuration: number;
    totalIdleTime: number;
    entriesCount: number;
    screenshotCount: number;
    byProject: Array<{ crmProjectId: string; projectName: string; totalDuration: number }>;
    byUser: Array<{ userId: string; userName: string; totalDuration: number }>;
  }>;
  getTaskDurationToday(userId: string, taskId: string, start: Date, end: Date): Promise<number>;
  getTasksDurationToday(
    userId: string,
    taskIds: string[],
    start: Date,
    end: Date
  ): Promise<Record<string, number>>;
  getTimeEntriesByIds(
    ids: string[]
  ): Promise<Array<{ id: string; duration: number; idleTime: number }>>;

  getAllowedTimezones(): Promise<string[]>;
  upsertAllowedTimezones(timezones: string[]): Promise<void>;
  applyTimerCommand(input: ApplyTimerCommandInput): Promise<ApplyTimerCommandResult>;
  listTimerCommands(userId: string): Promise<TimerCommand[]>;

  getAdminOverview(opts: AnalyticsOptions): Promise<{
    totalTrackedSeconds: number;
    totalIdleSeconds: number;
    entriesCount: number;
    runningNow: number;
    activeUsersToday: number;
    screenshotsInWindow: number;
    lowActivityEntries: number;
    revokedDevices: number;
  }>;
  getAdminProductivity(opts: AnalyticsOptions): Promise<{
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
      taskId: string;
      taskName: string;
      crmProjectId: string;
      projectName: string;
      clientName: string | null;
      totalSeconds: number;
    }>;
    dailyTrend: Array<{ date: string; totalSeconds: number }>;
  }>;
  /** The Time Entries touching the range, newest first. */
  getTimeExport(opts: AnalyticsOptions): Promise<TimeExportRow[]>;
}

export const timePersistence = {
  getAllowedTimezones,
  upsertAllowedTimezones,
  applyTimerCommand,
  listTimerCommands,
};

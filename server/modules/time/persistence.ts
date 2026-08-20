import type { TimeEntry, InsertTimeEntry, TimeEntryWithDetails } from "@shared/schema";

export interface TimePersistence {
  getTimeEntries(options: {
    userId?: string;
    crmProjectId?: string;
    startDate?: Date;
    endDate?: Date;
    endDateGte?: Date;
    status?: string;
  }): Promise<TimeEntryWithDetails[]>;
  getTimeEntry(id: string): Promise<TimeEntryWithDetails | undefined>;
  getTimeEntryByClientCommandId(clientCommandId: string): Promise<TimeEntry | undefined>;
  getActiveTimeEntry(userId: string): Promise<TimeEntry | undefined>;
  getStaleRunningEntries(staleThreshold: Date): Promise<TimeEntry[]>;
  createTimeEntry(entry: InsertTimeEntry): Promise<TimeEntry>;
  updateTimeEntry(id: string, data: Partial<InsertTimeEntry>): Promise<TimeEntry | undefined>;
  deleteTimeEntry(id: string): Promise<void>;
  getTimeStats(options: {
    userId?: string;
    crmProjectId?: string;
    startDate?: Date;
    endDate?: Date;
  }): Promise<{
    totalDuration: number;
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

  getAdminOverview(opts: { startDate: Date; endDate: Date }): Promise<{
    totalTrackedSeconds: number;
    totalIdleSeconds: number;
    entriesCount: number;
    runningNow: number;
    activeUsersToday: number;
    screenshotsInWindow: number;
    lowActivityEntries: number;
    revokedDevices: number;
  }>;
  getAdminProductivity(opts: {
    startDate: Date;
    endDate: Date;
    userId?: string;
    crmProjectId?: string;
  }): Promise<{
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
      totalSeconds: number;
      entriesCount: number;
    }>;
    byTask: Array<{ taskId: string | null; taskName: string; totalSeconds: number }>;
    dailyTrend: Array<{ date: string; totalSeconds: number }>;
  }>;
}

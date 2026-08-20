import type {
  TimeEntryScreenshot,
  InsertTimeEntryScreenshot,
  ScreenshotPolicy,
  EvidenceQualityReport,
} from "@shared/schema";
import {
  createAgentActivityEvents,
  createTimeEntryScreenshot,
  deleteTimeEntryScreenshot,
  getTimeEntryScreenshotById,
  getTimeEntryScreenshots,
  isAgentBatchProcessed,
  markAgentBatchProcessed,
  softDeleteTimeEntryScreenshot,
  updateTimeEntryScreenshot,
} from "./evidence";
import { getScreenshotPolicy, upsertScreenshotPolicy } from "./policy";

export interface ActivityPersistence {
  createTimeEntryScreenshot(screenshot: InsertTimeEntryScreenshot): Promise<TimeEntryScreenshot>;
  getTimeEntryScreenshotById(id: string): Promise<TimeEntryScreenshot | undefined>;
  getTimeEntryScreenshots(options: {
    timeEntryId?: string;
    userId?: string;
    crmProjectId?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
    offset?: number;
  }): Promise<{ data: TimeEntryScreenshot[]; total: number }>;
  updateTimeEntryScreenshot(
    id: string,
    data: { storageKey: string; contentHash?: string }
  ): Promise<TimeEntryScreenshot | undefined>;
  deleteTimeEntryScreenshot(id: string): Promise<void>;
  softDeleteTimeEntryScreenshot(
    id: string,
    deletedBy: string,
    reason?: string
  ): Promise<TimeEntryScreenshot | undefined>;

  getScreenshotPolicy(): Promise<ScreenshotPolicy>;
  upsertScreenshotPolicy(policy: Partial<ScreenshotPolicy>): Promise<void>;

  isAgentBatchProcessed(batchId: string): Promise<boolean>;
  markAgentBatchProcessed(batchId: string, deviceId: string, eventCount: number): Promise<void>;

  createAgentActivityEvents(
    events: Array<{
      deviceId: string;
      userId: string;
      timeEntryId: string | null;
      batchId: string;
      eventType: string;
      timestamp: Date;
      data?: Record<string, unknown>;
    }>
  ): Promise<void>;

  getEvidenceQualityReport(opts: {
    startDate: Date;
    endDate: Date;
    userId?: string;
  }): Promise<EvidenceQualityReport>;

  getAdminActivityStats(opts: {
    startDate: Date;
    endDate: Date;
    userId?: string;
  }): Promise<{
    byUser: Array<{
      userId: string;
      userName: string;
      totalSeconds: number;
      idleSeconds: number;
      idleRatio: number;
      idleEventCount: number;
    }>;
  }>;
  getAdminScreenshotStats(opts: {
    startDate: Date;
    endDate: Date;
    userId?: string;
  }): Promise<{
    totalCount: number;
    byUser: Array<{ userId: string; userName: string; count: number }>;
    hourlyDistribution: Array<{ hour: number; count: number }>;
    duplicates: Array<{ contentHash: string; count: number }>;
    deletedCount: number;
  }>;
  getAdminAlerts(opts: { startDate: Date; endDate: Date }): Promise<{
    highIdleUsers: Array<{
      userId: string;
      userName: string;
      idleRatio: number;
      totalSeconds: number;
    }>;
    stalledDevices: Array<{
      deviceId: string;
      deviceName: string;
      userId: string;
      userName: string;
      lastSeenAt: Date | null;
      daysSinceLastSeen: number;
    }>;
    runningWithoutScreenshots: Array<{
      userId: string;
      userName: string;
      entryId: string;
      startedAt: Date;
    }>;
  }>;
  getDataQualityReport(opts: {
    startDate: Date;
    endDate: Date;
    userId?: string;
  }): Promise<{
    byUser: Array<{
      userId: string;
      userName: string;
      trackedSeconds: number;
      screenshotCount: number;
      expectedScreenshots: number | null;
      screenshotCoveragePercent: number | null;
      duplicateScreenshots: number;
      activityEventCount: number;
      flags: string[];
    }>;
    org: {
      entriesWithoutAnyScreenshot: number;
      orgDuplicateScreenshots: number;
      stalledDevices: number;
      deletedScreenshots: number;
    };
  }>;
  getScreenshotCoverageReport(opts: {
    startDate: Date;
    endDate: Date;
    userId?: string;
    crmProjectId?: string;
  }): Promise<{
    summary: {
      totalTrackedSeconds: number;
      totalScreenshots: number;
      expectedScreenshots: number;
      coveragePercent: number | null;
      totalEntries: number;
      entriesWithoutScreenshots: number;
      lowCoverageEntries: number;
      deletedScreenshots: number;
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
    byProject: Array<{
      crmProjectId: string;
      projectName: string;
      trackedSeconds: number;
      entriesCount: number;
      entriesWithoutScreenshots: number;
      screenshotCount: number;
      expectedScreenshots: number;
      coveragePct: number | null;
    }>;
    byDay: Array<{
      date: string;
      trackedSeconds: number;
      screenshotCount: number;
      expectedScreenshots: number;
      coveragePct: number | null;
    }>;
  }>;
}

export const activityPersistence = {
  createTimeEntryScreenshot,
  getTimeEntryScreenshotById,
  getTimeEntryScreenshots,
  updateTimeEntryScreenshot,
  deleteTimeEntryScreenshot,
  softDeleteTimeEntryScreenshot,
  getScreenshotPolicy,
  upsertScreenshotPolicy,
  isAgentBatchProcessed,
  markAgentBatchProcessed,
  createAgentActivityEvents,
};


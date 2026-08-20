/**
 * Activity Evidence ingest — derived attribution rides the Phase 3 jobs port
 * (#118, ADR-0009, ADR-0013). HTTP stays a thin two-phase upload / idempotent
 * batch commit. The Job does not convert evidence into scores or rankings.
 */

import { db } from "../../db";
import {
  createJobsPort,
  workspaceOfCause,
  type Job,
  type JobTypeDeclaration,
  type JobsPort,
  type JobsWriter,
} from "../../jobs";
import { requireWorkspaceContext } from "../../workspaceContext";
import {
  createAgentActivityEvents,
  createTimeEntryScreenshot,
  getActivityEvidence,
  markAgentBatchProcessed,
  type ActivityWriter,
} from "./evidence";
import type { InsertTimeEntryScreenshot, TimeEntryScreenshot } from "@shared/schema";

export const ACTIVITY_ATTRIBUTE_JOB = "activity.attribute-evidence";

export const ACTIVITY_ATTRIBUTE_JOB_TYPE: JobTypeDeclaration = {
  attempts: 5,
  backoffMs: 60_000,
  timeoutMs: 30_000,
  concurrencyClass: "derived-processing",
};

export function createActivityJobsPort(): JobsPort {
  return createJobsPort({
    db,
    types: { [ACTIVITY_ATTRIBUTE_JOB]: ACTIVITY_ATTRIBUTE_JOB_TYPE },
  });
}

type ActivityJobsWriter = ActivityWriter & JobsWriter;

export async function ingestActivityScreenshot(input: {
  jobs: JobsPort;
  screenshot: InsertTimeEntryScreenshot;
  tx?: ActivityJobsWriter;
}): Promise<TimeEntryScreenshot> {
  const persist = async (writer: ActivityJobsWriter) => {
    const row = await createTimeEntryScreenshot(input.screenshot, writer);
    await input.jobs.enqueue(
      {
        type: ACTIVITY_ATTRIBUTE_JOB,
        payload: { kind: "screenshot", screenshotId: row.id },
        workspaceId: workspaceOfCause(row.workspaceId),
        occurrenceKey: `activity.attribute-evidence:screenshot:${row.id}`,
      },
      writer
    );
    return row;
  };
  if (input.tx) return persist(input.tx);
  return db.transaction(persist);
}

export async function ingestActivityEvents(input: {
  jobs: JobsPort;
  batchId: string;
  deviceId: string;
  events: Array<{
    deviceId: string;
    userId: string;
    timeEntryId: string | null;
    batchId: string;
    eventType: string;
    timestamp: Date;
    data?: Record<string, unknown>;
  }>;
  tx?: ActivityJobsWriter;
}): Promise<void> {
  const persist = async (writer: ActivityJobsWriter) => {
    await createAgentActivityEvents(input.events, writer);
    await markAgentBatchProcessed(input.batchId, input.deviceId, input.events.length, writer);
    const timeEntryId = input.events[0]?.timeEntryId ?? null;
    await input.jobs.enqueue(
      {
        type: ACTIVITY_ATTRIBUTE_JOB,
        payload: { kind: "events", batchId: input.batchId, timeEntryId },
        workspaceId: workspaceOfCause(requireWorkspaceContext().workspaceId),
        occurrenceKey: `activity.attribute-evidence:events:${input.batchId}`,
      },
      writer
    );
  };
  if (input.tx) return persist(input.tx);
  await db.transaction(persist);
}

export async function handleAttributeEvidenceJob(job: Job): Promise<void> {
  requireWorkspaceContext();
  const payload = job.payload as { kind?: unknown; screenshotId?: unknown };
  if (payload.kind === "events") return;
  if (payload.kind !== "screenshot") {
    throw new Error(`Job "${job.id}" has unknown evidence kind.`);
  }
  if (typeof payload.screenshotId !== "string" || payload.screenshotId.length === 0) {
    throw new Error(`Job "${job.id}" is missing a screenshotId.`);
  }
  await getActivityEvidence(payload.screenshotId);
}

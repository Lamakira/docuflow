/**
 * Activity Evidence ingest — derived attribution rides the Phase 3 jobs port
 * (#118, ADR-0009, ADR-0013). HTTP stays a thin two-phase upload / idempotent
 * batch commit. Screenshot Jobs enqueue only after a final storage key is
 * committed (not on pending-*). Events ingest does not enqueue until a real
 * attribution handler exists. The Job does not convert evidence into scores
 * or rankings.
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
  updateTimeEntryScreenshot,
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

function isPendingStorageKey(storageKey: string): boolean {
  return storageKey.startsWith("pending-");
}

function screenshotOccurrenceKey(screenshotId: string): string {
  return `activity.attribute-evidence:screenshot:${screenshotId}`;
}

async function enqueueScreenshotAttribution(
  jobs: JobsPort,
  row: { id: string; workspaceId?: string | null },
  writer: JobsWriter
): Promise<void> {
  await jobs.enqueue(
    {
      type: ACTIVITY_ATTRIBUTE_JOB,
      payload: { kind: "screenshot", screenshotId: row.id },
      workspaceId: workspaceOfCause(row.workspaceId),
      occurrenceKey: screenshotOccurrenceKey(row.id),
    },
    writer
  );
}

export async function ingestActivityScreenshot(input: {
  jobs: JobsPort;
  screenshot: InsertTimeEntryScreenshot;
  tx?: ActivityJobsWriter;
}): Promise<TimeEntryScreenshot> {
  const persist = async (writer: ActivityJobsWriter) => {
    const row = await createTimeEntryScreenshot(input.screenshot, writer);
    // Two-phase upload: a pending-* row is only a slot. Attribution waits
    // until commitActivityScreenshot replaces that key with committed bytes.
    if (!isPendingStorageKey(row.storageKey)) {
      await enqueueScreenshotAttribution(input.jobs, row, writer);
    }
    return row;
  };
  if (input.tx) return persist(input.tx);
  return db.transaction(persist);
}

export async function commitActivityScreenshot(input: {
  jobs: JobsPort;
  id: string;
  storageKey: string;
  contentHash?: string;
  tx?: ActivityJobsWriter;
}): Promise<TimeEntryScreenshot | undefined> {
  const persist = async (writer: ActivityJobsWriter) => {
    const row = await updateTimeEntryScreenshot(
      input.id,
      { storageKey: input.storageKey, contentHash: input.contentHash },
      writer
    );
    if (!row) return undefined;
    if (!isPendingStorageKey(row.storageKey)) {
      await enqueueScreenshotAttribution(input.jobs, row, writer);
    }
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
  // Events are committed in this transaction. Do not enqueue
  // activity.attribute-evidence:events:<batchId> until a real attribution
  // handler exists — a completing stub would burn that occurrence key.
  const persist = async (writer: ActivityJobsWriter) => {
    await createAgentActivityEvents(input.events, writer);
    await markAgentBatchProcessed(input.batchId, input.deviceId, input.events.length, writer);
  };
  if (input.tx) return persist(input.tx);
  await db.transaction(persist);
}

export async function handleAttributeEvidenceJob(job: Job): Promise<void> {
  requireWorkspaceContext();
  const payload = job.payload as { kind?: unknown; screenshotId?: unknown };
  if (payload.kind === "events") {
    throw new Error(
      `Job "${job.id}" is an events attribution stub; events ingest does not enqueue until a real handler exists.`
    );
  }
  if (payload.kind !== "screenshot") {
    throw new Error(`Job "${job.id}" has unknown evidence kind.`);
  }
  if (typeof payload.screenshotId !== "string" || payload.screenshotId.length === 0) {
    throw new Error(`Job "${job.id}" is missing a screenshotId.`);
  }
  const evidence = await getActivityEvidence(payload.screenshotId);
  if (!evidence) {
    throw new Error(
      `Job "${job.id}" has no Activity Evidence for screenshot "${payload.screenshotId}".`
    );
  }
  if (isPendingStorageKey(evidence.storageKey)) {
    throw new Error(
      `Job "${job.id}" cannot attribute a pending screenshot "${payload.screenshotId}".`
    );
  }
}

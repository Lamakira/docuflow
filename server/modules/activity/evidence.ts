/**
 * Activity Evidence — screenshots and agent activity events (#118).
 * Stored and queried here. Project and task provenance come from the Time
 * Entry the evidence is attached to. Evidence is not turned into scores.
 */

import { and, desc, eq, gte, isNull, lte, sql, type SQL } from "drizzle-orm";
import {
  agentActivityEvents,
  agentProcessedBatches,
  companyDocuments,
  crmClients,
  crmProjects,
  files,
  projects,
  tasks,
  timeEntries,
  timeEntryScreenshots,
  users,
  type DocumentPerson,
  type InsertTimeEntryScreenshot,
  type TimeEntryScreenshot,
} from "@shared/schema";
import { DEFAULT_LOW_ACTIVITY_THRESHOLD_PERCENT, SIMILAR_MAX_HAMMING_DISTANCE } from "@shared/activityEvidence";
import { db, type Db } from "../../db";
import { inWorkspace, stampWorkspace } from "../../workspaceContext";

export type ActivityWriter = Pick<Db, "insert" | "select" | "update" | "delete">;

export interface ActivityEvidence {
  id: string;
  crmProjectId: string;
  timeEntryId: string;
  taskId: string | null;
  storageKey: string;
}

export async function createTimeEntryScreenshot(
  screenshot: InsertTimeEntryScreenshot,
  writer: Pick<Db, "insert"> = db
): Promise<TimeEntryScreenshot> {
  const [result] = await writer
    .insert(timeEntryScreenshots)
    .values(stampWorkspace(screenshot))
    .returning();
  return result;
}

export async function getTimeEntryScreenshotById(
  id: string
): Promise<TimeEntryScreenshot | undefined> {
  const [screenshot] = await db
    .select()
    .from(timeEntryScreenshots)
    .where(and(eq(timeEntryScreenshots.id, id), inWorkspace(timeEntryScreenshots)));
  return screenshot;
}

export type ScreenshotListOptions = {
  timeEntryId?: string;
  userId?: string;
  crmProjectId?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
  /** Keep low-activity captures only (#341), judged against `lowActivityThresholdPercent`. */
  lowActivityOnly?: boolean;
  /** The Workspace's Tracking Policy threshold; the default when absent. */
  lowActivityThresholdPercent?: number;
  /** Keep captures Similar to the previous capture of the same Member only (#341). */
  similarOnly?: boolean;
};

export type ListedScreenshot = Pick<
  TimeEntryScreenshot,
  | "id"
  | "userId"
  | "timeEntryId"
  | "crmProjectId"
  | "capturedAt"
  | "keyboardActivityPercent"
  | "mouseActivityPercent"
  | "keyboardCount"
  | "mouseCount"
  /** v1's Identical filter reads it. */
  | "contentHash"
> & {
  /** Within SIMILAR_MAX_HAMMING_DISTANCE of the same Member's previous live capture. */
  similarToPrevious: boolean;
  entryDuration: number;
  entryIdleTime: number;
  source: "device" | "web";
  user: DocumentPerson | null;
  projectName: string | null;
  clientName: string | null;
  /** The Task's name, else the Time Entry's description. */
  taskName: string | null;
};

export type ScreenshotList = {
  data: ListedScreenshot[];
  /** Captures matching every filter, the two lenses included: what paging walks. */
  total: number;
  /** Over the same period and facets, before the two lenses apply. */
  counts: { lowActivity: number; similar: number };
};

/**
 * SQL twin of `isLowActivityCapture` (shared/activityEvidence.ts): both metrics
 * recorded and both strictly below the threshold; a capture without metrics is
 * never low. A test holds the two to the same answers.
 */
export function lowActivityPredicate(thresholdPercent: number): SQL {
  return sql`(${timeEntryScreenshots.keyboardActivityPercent} IS NOT NULL
    AND ${timeEntryScreenshots.mouseActivityPercent} IS NOT NULL
    AND ${timeEntryScreenshots.keyboardActivityPercent} < ${thresholdPercent}
    AND ${timeEntryScreenshots.mouseActivityPercent} < ${thresholdPercent})`;
}

/**
 * SQL twin of `isSimilarFingerprint` against the same Member's previous live
 * capture: same Workspace and user, strictly earlier, not deleted, uploaded —
 * whatever its project, and even before the requested period. The Hamming
 * distance is the bit count of the XOR of the two 64-bit fingerprints. A missing
 * fingerprint on either side is never Similar.
 */
export function similarToPreviousPredicate(): SQL {
  const hex = "^[0-9a-f]{16}$";
  return sql`COALESCE((
    SELECT bit_count(('x' || ${timeEntryScreenshots.perceptualHash})::bit(64) # ('x' || prev.perceptual_hash)::bit(64))
      <= ${SIMILAR_MAX_HAMMING_DISTANCE}
    FROM time_entry_screenshots prev
    WHERE prev.workspace_id = ${timeEntryScreenshots.workspaceId}
      AND prev.user_id = ${timeEntryScreenshots.userId}
      AND prev.captured_at < ${timeEntryScreenshots.capturedAt}
      AND prev.deleted_at IS NULL
      AND prev.storage_key NOT LIKE 'pending-%'
    ORDER BY prev.captured_at DESC
    LIMIT 1
  ), false) AND ${timeEntryScreenshots.perceptualHash} ~ ${hex}`;
}

/** Whether a capture, a File or a Document of this Workspace already names the object. */
export async function isStoredObjectNamed(objectPath: string): Promise<boolean> {
  const [named] = await db
    .select({ id: timeEntryScreenshots.id })
    .from(timeEntryScreenshots)
    .where(and(inWorkspace(timeEntryScreenshots), eq(timeEntryScreenshots.storageKey, objectPath)))
    .union(
      db.select({ id: files.id }).from(files).where(and(inWorkspace(files), eq(files.storagePath, objectPath)))
    )
    .union(
      db
        .select({ id: companyDocuments.id })
        .from(companyDocuments)
        .where(and(inWorkspace(companyDocuments), eq(companyDocuments.storagePath, objectPath)))
    )
    .limit(1);
  return named !== undefined;
}

export async function getTimeEntryScreenshots(options: ScreenshotListOptions): Promise<ScreenshotList> {
  const conditions = [inWorkspace(timeEntryScreenshots)];
  if (options.timeEntryId) conditions.push(eq(timeEntryScreenshots.timeEntryId, options.timeEntryId));
  if (options.userId) conditions.push(eq(timeEntryScreenshots.userId, options.userId));
  if (options.crmProjectId) conditions.push(eq(timeEntryScreenshots.crmProjectId, options.crmProjectId));
  if (options.startDate) conditions.push(gte(timeEntryScreenshots.capturedAt, options.startDate));
  if (options.endDate) conditions.push(lte(timeEntryScreenshots.capturedAt, options.endDate));
  conditions.push(sql`${timeEntryScreenshots.storageKey} NOT LIKE 'pending-%'`);
  conditions.push(isNull(timeEntryScreenshots.deletedAt));

  const low = lowActivityPredicate(options.lowActivityThresholdPercent ?? DEFAULT_LOW_ACTIVITY_THRESHOLD_PERCENT);
  const similar = similarToPreviousPredicate();

  const base = and(...conditions);
  const lensConditions = [...conditions];
  if (options.lowActivityOnly) lensConditions.push(low);
  if (options.similarOnly) lensConditions.push(similar);
  const where = and(...lensConditions);
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;

  const [data, totalResult, countsResult] = await Promise.all([
    db
      .select({
        id: timeEntryScreenshots.id,
        userId: timeEntryScreenshots.userId,
        timeEntryId: timeEntryScreenshots.timeEntryId,
        crmProjectId: timeEntryScreenshots.crmProjectId,
        capturedAt: timeEntryScreenshots.capturedAt,
        keyboardActivityPercent: timeEntryScreenshots.keyboardActivityPercent,
        mouseActivityPercent: timeEntryScreenshots.mouseActivityPercent,
        keyboardCount: timeEntryScreenshots.keyboardCount,
        mouseCount: timeEntryScreenshots.mouseCount,
        contentHash: timeEntryScreenshots.contentHash,
        similarToPrevious: sql<boolean>`(${similar})`,
        entryDuration: sql<number>`coalesce(${timeEntries.duration}, 0)`,
        entryIdleTime: sql<number>`coalesce(${timeEntries.idleTime}, 0)`,
        source: sql<"device" | "web">`case when ${timeEntryScreenshots.storageKey} like '%agent-screenshots%' then 'device' else 'web' end`,
        user: {
          id: users.id,
          email: users.email,
          firstName: users.firstName,
          lastName: users.lastName,
          profileImageUrl: users.profileImageUrl,
        },
        projectName: projects.name,
        clientName: crmClients.name,
        taskName: sql<string | null>`coalesce(${tasks.name}, nullif(btrim(${timeEntries.description}), ''))`,
      })
      .from(timeEntryScreenshots)
      .leftJoin(timeEntries, and(eq(timeEntries.id, timeEntryScreenshots.timeEntryId), inWorkspace(timeEntries)))
      .leftJoin(tasks, and(eq(tasks.id, timeEntries.taskId), inWorkspace(tasks)))
      .leftJoin(crmProjects, and(eq(crmProjects.id, timeEntryScreenshots.crmProjectId), inWorkspace(crmProjects)))
      .leftJoin(projects, and(eq(projects.id, crmProjects.projectId), inWorkspace(projects)))
      .leftJoin(crmClients, and(eq(crmClients.id, crmProjects.clientId), inWorkspace(crmClients)))
      .leftJoin(users, eq(users.id, timeEntryScreenshots.userId))
      .where(where)
      .orderBy(desc(timeEntryScreenshots.capturedAt), desc(timeEntryScreenshots.id))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(timeEntryScreenshots)
      .where(where),
    db
      .select({
        lowActivity: sql<number>`(count(*) FILTER (WHERE ${low}))::int`,
        similar: sql<number>`(count(*) FILTER (WHERE ${similar}))::int`,
      })
      .from(timeEntryScreenshots)
      .where(base),
  ]);

  return {
    data: data.map((row) => ({ ...row, similarToPrevious: row.similarToPrevious === true })),
    total: totalResult[0]?.count ?? 0,
    counts: {
      lowActivity: countsResult[0]?.lowActivity ?? 0,
      similar: countsResult[0]?.similar ?? 0,
    },
  };
}

export async function updateTimeEntryScreenshot(
  id: string,
  data: { storageKey: string; contentHash?: string; perceptualHash?: string | null },
  writer: Pick<Db, "update"> = db
): Promise<TimeEntryScreenshot | undefined> {
  const [result] = await writer
    .update(timeEntryScreenshots)
    .set({ storageKey: data.storageKey, ...(data.contentHash ? { contentHash: data.contentHash } : {}),
      ...(data.perceptualHash ? { perceptualHash: data.perceptualHash } : {}),
    })
    .where(and(eq(timeEntryScreenshots.id, id), inWorkspace(timeEntryScreenshots)))
    .returning();
  return result;
}

export async function deleteTimeEntryScreenshot(id: string): Promise<void> {
  await db
    .delete(timeEntryScreenshots)
    .where(and(eq(timeEntryScreenshots.id, id), inWorkspace(timeEntryScreenshots)));
}

export async function softDeleteTimeEntryScreenshot(
  id: string,
  deletedBy: string,
  reason?: string
): Promise<TimeEntryScreenshot | undefined> {
  const [existing] = await db
    .select({ deletedAt: timeEntryScreenshots.deletedAt })
    .from(timeEntryScreenshots)
    .where(and(eq(timeEntryScreenshots.id, id), inWorkspace(timeEntryScreenshots)));
  if (!existing || existing.deletedAt !== null) return undefined;

  const [updated] = await db
    .update(timeEntryScreenshots)
    .set({
      deletedAt: new Date(),
      deletedBy,
      deleteReason: reason ?? null,
    })
    .where(and(eq(timeEntryScreenshots.id, id), inWorkspace(timeEntryScreenshots)))
    .returning();
  return updated;
}

export async function getActivityEvidence(id: string): Promise<ActivityEvidence | undefined> {
  const [row] = await db
    .select({
      id: timeEntryScreenshots.id,
      crmProjectId: timeEntryScreenshots.crmProjectId,
      timeEntryId: timeEntryScreenshots.timeEntryId,
      taskId: timeEntries.taskId,
      storageKey: timeEntryScreenshots.storageKey,
    })
    .from(timeEntryScreenshots)
    .innerJoin(timeEntries, eq(timeEntryScreenshots.timeEntryId, timeEntries.id))
    .where(and(eq(timeEntryScreenshots.id, id), inWorkspace(timeEntryScreenshots)));
  return row;
}

export async function isAgentBatchProcessed(batchId: string): Promise<boolean> {
  const [result] = await db
    .select()
    .from(agentProcessedBatches)
    .where(and(eq(agentProcessedBatches.batchId, batchId), inWorkspace(agentProcessedBatches)));
  return !!result;
}

export async function markAgentBatchProcessed(
  batchId: string,
  deviceId: string,
  eventCount: number,
  writer: Pick<Db, "insert"> = db
): Promise<void> {
  await writer
    .insert(agentProcessedBatches)
    .values(stampWorkspace({ batchId, deviceId, eventCount }));
}

export async function createAgentActivityEvents(
  events: Array<{
    deviceId: string;
    userId: string;
    timeEntryId: string | null;
    batchId: string;
    eventType: string;
    timestamp: Date;
    data?: Record<string, unknown>;
  }>,
  writer: Pick<Db, "insert"> = db
): Promise<void> {
  if (events.length === 0) return;
  await writer.insert(agentActivityEvents).values(events.map((event) => stampWorkspace(event)));
}

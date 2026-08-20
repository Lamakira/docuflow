/**
 * Activity Evidence — screenshots and agent activity events (#118).
 * Stored and queried here. Project and task provenance come from the Time
 * Entry the evidence is attached to. Evidence is not turned into scores.
 */

import { and, desc, eq, gt, isNull, lte, sql } from "drizzle-orm";
import {
  agentActivityEvents,
  agentProcessedBatches,
  timeEntries,
  timeEntryScreenshots,
  type InsertTimeEntryScreenshot,
  type TimeEntryScreenshot,
} from "@shared/schema";
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

export async function getTimeEntryScreenshots(options: {
  timeEntryId?: string;
  userId?: string;
  crmProjectId?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}): Promise<{ data: TimeEntryScreenshot[]; total: number }> {
  const conditions = [inWorkspace(timeEntryScreenshots)];
  if (options.timeEntryId) conditions.push(eq(timeEntryScreenshots.timeEntryId, options.timeEntryId));
  if (options.userId) conditions.push(eq(timeEntryScreenshots.userId, options.userId));
  if (options.crmProjectId) conditions.push(eq(timeEntryScreenshots.crmProjectId, options.crmProjectId));
  if (options.startDate) conditions.push(gt(timeEntryScreenshots.capturedAt, options.startDate));
  if (options.endDate) conditions.push(lte(timeEntryScreenshots.capturedAt, options.endDate));
  conditions.push(sql`${timeEntryScreenshots.storageKey} NOT LIKE 'pending-%'`);
  conditions.push(isNull(timeEntryScreenshots.deletedAt));

  const where = and(...conditions);
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;

  const [data, countResult] = await Promise.all([
    db
      .select()
      .from(timeEntryScreenshots)
      .where(where)
      .orderBy(desc(timeEntryScreenshots.capturedAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(timeEntryScreenshots)
      .where(where),
  ]);

  return { data, total: countResult[0]?.count ?? 0 };
}

export async function updateTimeEntryScreenshot(
  id: string,
  data: { storageKey: string; contentHash?: string },
  writer: Pick<Db, "update"> = db
): Promise<TimeEntryScreenshot | undefined> {
  const [result] = await writer
    .update(timeEntryScreenshots)
    .set({ storageKey: data.storageKey, ...(data.contentHash ? { contentHash: data.contentHash } : {}) })
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

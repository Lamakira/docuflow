/**
 * Copies of one capture (F75): the same Time Entry, instant and image, stored
 * again by an agent that ran two uploads at once. A copy is a tombstone with a
 * reason of its own and no one who deleted it, so it never reads as a capture
 * an Administrator removed.
 */

import { and, eq, isNull, sql, type SQL } from "drizzle-orm";
import { timeEntryScreenshots } from "@shared/schema";
import { db } from "../../db";
import { inWorkspace, requireWorkspaceContext } from "../../workspaceContext";

/** Not a reason an Administrator would type: once they leave, `deleted_by` is null too. */
export const DUPLICATE_CAPTURE_REASON = "system:duplicate-capture";

/** Left out of every count of deleted captures. `delete_reason` may be null, hence IS DISTINCT FROM. */
export function notDuplicateCapture(): SQL {
  return sql`(${timeEntryScreenshots.deleteReason} IS DISTINCT FROM ${DUPLICATE_CAPTURE_REASON}
    OR ${timeEntryScreenshots.deletedBy} IS NOT NULL)`;
}

export interface DuplicateCaptureCounts {
  sets: number;
  copies: number;
}

/**
 * The live rows to hide: all but the earliest live one of each set, and every
 * live one of a set an Administrator deleted from. Ranked among live rows only,
 * so a set keeps its row whichever one the upload path hid, and a rerun or the
 * next batch finds the same one.
 */
function copiesQuery(): SQL {
  return sql`
    SELECT id, time_entry_id, captured_at, content_hash
    FROM (
      SELECT id, time_entry_id, captured_at, content_hash, deleted_at,
        bool_or(deleted_at IS NOT NULL
          AND (delete_reason IS DISTINCT FROM ${DUPLICATE_CAPTURE_REASON} OR deleted_by IS NOT NULL))
          OVER (PARTITION BY time_entry_id, captured_at, content_hash) AS removed,
        row_number() OVER (
          PARTITION BY time_entry_id, captured_at, content_hash, (deleted_at IS NULL)
          ORDER BY created_at, id) AS place
      FROM time_entry_screenshots
      WHERE workspace_id = ${requireWorkspaceContext().workspaceId}
        AND content_hash IS NOT NULL
        AND storage_key NOT LIKE 'pending-%'
    ) ranked
    WHERE deleted_at IS NULL AND (removed OR place > 1)`;
}

export async function countDuplicateCaptures(): Promise<DuplicateCaptureCounts> {
  const result = await db.execute(sql`
    SELECT count(*)::int AS copies,
      count(DISTINCT (time_entry_id, captured_at, content_hash))::int AS sets
    FROM (${copiesQuery()}) copies`);
  const row = result.rows[0] as { copies: number; sets: number };
  return { sets: row.sets, copies: row.copies };
}

export async function hideDuplicateCaptures(options: { batchSize?: number } = {}): Promise<number> {
  const batchSize = options.batchSize ?? 1000;
  let hidden = 0;
  for (;;) {
    const rows = await db
      .update(timeEntryScreenshots)
      .set({ deletedAt: new Date(), deletedBy: null, deleteReason: DUPLICATE_CAPTURE_REASON })
      .where(
        and(
          inWorkspace(timeEntryScreenshots),
          isNull(timeEntryScreenshots.deletedAt),
          sql`${timeEntryScreenshots.id} IN (SELECT id FROM (${copiesQuery()}) copies ORDER BY id LIMIT ${batchSize})`
        )
      )
      .returning({ id: timeEntryScreenshots.id });
    if (rows.length === 0) return hidden;
    hidden += rows.length;
  }
}

/** A copy of a capture an Administrator deleted stays hidden: it is the same image. */
export async function restoreDuplicateCaptures(): Promise<number> {
  const rows = await db
    .update(timeEntryScreenshots)
    .set({ deletedAt: null, deleteReason: null })
    .where(
      and(
        inWorkspace(timeEntryScreenshots),
        eq(timeEntryScreenshots.deleteReason, DUPLICATE_CAPTURE_REASON),
        isNull(timeEntryScreenshots.deletedBy),
        sql`NOT EXISTS (
          SELECT 1 FROM time_entry_screenshots removed
          WHERE removed.workspace_id = ${timeEntryScreenshots.workspaceId}
            AND removed.time_entry_id = ${timeEntryScreenshots.timeEntryId}
            AND removed.captured_at = ${timeEntryScreenshots.capturedAt}
            AND removed.content_hash = ${timeEntryScreenshots.contentHash}
            AND removed.deleted_at IS NOT NULL
            AND (removed.delete_reason IS DISTINCT FROM ${DUPLICATE_CAPTURE_REASON} OR removed.deleted_by IS NOT NULL))`
      )
    )
    .returning({ id: timeEntryScreenshots.id });
  return rows.length;
}

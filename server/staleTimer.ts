/**
 * Stale-timer detection (#84). Flag-only: a running Time Entry with no
 * heartbeat past the threshold is logged and left running. The HTTP interval
 * and the Worker Job both call this.
 *
 * Paused-expiry (#330) is the exception that does stop: a Time Entry paused
 * past PAUSED_EXPIRY_MS is stopped through a Timer Command, ending at its
 * pause time.
 */

import type { Job, JobTypeDeclaration, JobsPort } from "./jobs";
import { workspaceOfCause } from "./jobs";
import { logError, logInfo, logStaleSession } from "./logger";
import { applyTimerCommand, nextTimerSequence } from "./modules/time/commands";
import { storage } from "./storage";
import { forEachWorkspace, runWithWorkspaceContext } from "./workspaceContext";

export const STALE_TIMER_JOB = "stale-timer.flag";

export const STALE_TIMER_JOB_TYPE: JobTypeDeclaration = {
  attempts: 5,
  backoffMs: 60_000,
  timeoutMs: 30_000,
  concurrencyClass: "domain-consequence",
};

export const STALE_THRESHOLD_MS = 10 * 60 * 1000;
export const STALE_CHECK_WINDOW_MS = 2 * 60 * 1000;

export const PAUSED_EXPIRY_MS = 12 * 60 * 60 * 1000;

export function staleTimerOccurrenceKey(entryId: string, at: Date): string {
  const window = Math.floor(at.getTime() / STALE_CHECK_WINDOW_MS);
  return `stale-timer:${entryId}:${window}`;
}

export async function flagStaleTimeEntry(entryId: string, at: Date): Promise<boolean> {
  const entry = await storage.getTimeEntry(entryId);
  if (!entry || entry.status !== "running") return false;
  const lastActivity = entry.lastActivityAt;
  if (!lastActivity || lastActivity.getTime() >= at.getTime() - STALE_THRESHOLD_MS) {
    return false;
  }
  logStaleSession(entry.id, entry.userId, lastActivity.toISOString());
  return true;
}

export async function flagStaleRunningEntries(at: Date): Promise<number> {
  const counts = await forEachWorkspace(async () => {
    const threshold = new Date(at.getTime() - STALE_THRESHOLD_MS);
    const stale = await storage.getStaleRunningEntries(threshold);
    let flagged = 0;
    for (const entry of stale) {
      if (await flagStaleTimeEntry(entry.id, at)) flagged += 1;
    }
    return flagged;
  });
  return counts.reduce((sum, n) => sum + n, 0);
}

/**
 * Stop Time Entries paused longer than PAUSED_EXPIRY_MS (#330). The stop goes
 * through the Timer Command ingest so a later rematerialization keeps it
 * stopped (ADR-0009); the per-pause sequence makes a repeat run a no-op.
 */
export async function stopExpiredPausedEntries(at: Date): Promise<number> {
  const counts = await forEachWorkspace(async () => {
    const expired = await storage.getExpiredPausedEntries(new Date(at.getTime() - PAUSED_EXPIRY_MS));
    let stopped = 0;
    for (const entry of expired) {
      try {
        const result = await runWithWorkspaceContext(
          { workspaceId: entry.workspaceId, userId: entry.userId },
          async () =>
            applyTimerCommand({
              userId: entry.userId,
              origin: "server:paused-expiry",
              // Keyed on the pause, not the entry: a later pause of the same entry is a new stop.
              sequence: nextTimerSequence(`paused-expiry:${entry.id}:${entry.lastActivityAt?.toISOString()}`),
              kind: "stop",
              claimedEffectiveAt: at,
              payload: { timeEntryId: entry.id },
            })
        );
        if (result.duplicate) continue;
        logInfo("time-tracking.paused-expired", {
          entryId: entry.id,
          userId: entry.userId,
          pausedAt: entry.lastActivityAt?.toISOString() ?? null,
        });
        stopped += 1;
      } catch (error) {
        logError("time-tracking.paused-expired.failed", error, { entryId: entry.id, userId: entry.userId });
      }
    }
    return stopped;
  });
  return counts.reduce((sum, n) => sum + n, 0);
}

export async function enqueueStaleTimerJobs(jobs: JobsPort, at: Date): Promise<number> {
  const stale = await storage.getStaleRunningEntries(new Date(at.getTime() - STALE_THRESHOLD_MS));
  let created = 0;
  for (const entry of stale) {
    const enqueued = await jobs.enqueue({
      type: STALE_TIMER_JOB,
      payload: { entryId: entry.id, checkedAt: at.toISOString() },
      occurrenceKey: staleTimerOccurrenceKey(entry.id, at),
      workspaceId: workspaceOfCause(entry.workspaceId),
    });
    if (enqueued.created) created += 1;
  }
  return created;
}

export async function handleStaleTimerJob(job: Job): Promise<void> {
  const payload = job.payload as { entryId?: unknown; checkedAt?: unknown };
  const entryId = payload.entryId;
  if (typeof entryId !== "string" || entryId.length === 0) {
    throw new Error(`Job "${job.id}" is missing an entryId.`);
  }
  const checkedAt =
    typeof payload.checkedAt === "string" ? new Date(payload.checkedAt) : new Date();
  await flagStaleTimeEntry(entryId, checkedAt);
}

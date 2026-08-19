/**
 * Stale-timer detection (#84). Flag-only: a running Time Entry with no
 * heartbeat past the threshold is logged and left running. The HTTP interval
 * and the Worker Job both call this.
 */

import type { Job, JobTypeDeclaration, JobsPort } from "./jobs";
import { workspaceOfCause } from "./jobs";
import { logStaleSession } from "./logger";
import { storage } from "./storage";
import { forEachWorkspace } from "./workspaceContext";

export const STALE_TIMER_JOB = "stale-timer.flag";

export const STALE_TIMER_JOB_TYPE: JobTypeDeclaration = {
  attempts: 5,
  backoffMs: 60_000,
  timeoutMs: 30_000,
  concurrencyClass: "domain-consequence",
};

export const STALE_THRESHOLD_MS = 10 * 60 * 1000;
export const STALE_CHECK_WINDOW_MS = 2 * 60 * 1000;

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

/**
 * The Worker runtime (#83, #84, #85). Only a process with the worker role claims
 * Jobs. HTTP never claims — it may still run due-reminder, stale-timer, and
 * Daily Update nudge work on its interval while that flag stays on.
 */

import type { Job, JobsPort } from "./jobs";
import type { ProcessRole } from "./config";
import { MissingWorkspaceContextError, runWithWorkspaceContext } from "./workspaceContext";

export type JobHandler = (job: Job) => Promise<void>;

export interface JobRunner {
  /** Claims and runs one Job. An HTTP-role runner never claims. */
  runOne(): Promise<Job | null>;
}

export interface CreateJobRunnerOptions {
  role: ProcessRole;
  jobs: JobsPort;
  handlers: Record<string, JobHandler>;
  claimerId: string;
}

export function createJobRunner(options: CreateJobRunnerOptions): JobRunner {
  const { role, jobs, handlers, claimerId } = options;

  return {
    async runOne() {
      if (role !== "worker") return null;

      const job = await jobs.claim(claimerId);
      if (!job) return null;

      const handler = handlers[job.type];
      if (!handler) {
        await jobs.fail(job.id, claimerId, `No handler registered for Job type "${job.type}".`);
        return job;
      }

      if (!job.workspaceId) {
        await jobs.fail(job.id, claimerId, new MissingWorkspaceContextError().message);
        return job;
      }

      try {
        await runWithWorkspaceContext({ workspaceId: job.workspaceId }, () => handler(job));
        await jobs.complete(job.id, claimerId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await jobs.fail(job.id, claimerId, message);
      }
      return job;
    },
  };
}

const TICK_EVERY_MS = 60_000;
const POLL_MS = 1_000;

export interface WorkerLoop {
  stop: () => void;
  running: Promise<void>;
}

/**
 * Claim loop for `DOCUFLOW_ROLE=worker`. HTTP never calls this. The process
 * stays alive on the loop rather than by listening — ticket 86 is the Reserved
 * VM that hosts it.
 */
export function startWorkerLoop(options?: {
  pollMs?: number;
  tickEveryMs?: number;
  claimerId?: string;
}): WorkerLoop {
  const pollMs = options?.pollMs ?? POLL_MS;
  const tickEveryMs = options?.tickEveryMs ?? TICK_EVERY_MS;
  const claimerId = options?.claimerId ?? `worker-${process.pid}`;
  let stopped = false;

  const running = (async () => {
    const { db } = await import("./db");
    const { createJobsPort } = await import("./jobs");
    const {
      DUE_REMINDER_JOB,
      DUE_REMINDER_JOB_TYPE,
      handleDueReminderJob,
    } = await import("./dueReminders");
    const {
      STALE_TIMER_JOB,
      STALE_TIMER_JOB_TYPE,
      handleStaleTimerJob,
    } = await import("./staleTimer");
    const {
      DAILY_UPDATE_NUDGE_JOB,
      DAILY_UPDATE_NUDGE_JOB_TYPE,
      handleDailyUpdateNudgeJob,
    } = await import("./dailyUpdateNudge");
    const {
      DOCUMENT_EMBED_JOB,
      DOCUMENT_EMBED_JOB_TYPE,
      DOCUMENT_TRANSCRIPT_JOB,
      DOCUMENT_TRANSCRIPT_JOB_TYPE,
      handleDocumentEmbedJob,
      handleDocumentTranscriptJob,
    } = await import("./documentJobs");
    const {
      ACTIVITY_ATTRIBUTE_JOB,
      ACTIVITY_ATTRIBUTE_JOB_TYPE,
      handleAttributeEvidenceJob,
    } = await import("./modules/activity/evidenceJobs");
    const {
      createDueReminderScheduler,
      createStaleTimerScheduler,
      createDailyUpdateNudgeScheduler,
    } = await import("./scheduler");

    const jobs = createJobsPort({
      db,
      types: {
        [DUE_REMINDER_JOB]: DUE_REMINDER_JOB_TYPE,
        [STALE_TIMER_JOB]: STALE_TIMER_JOB_TYPE,
        [DAILY_UPDATE_NUDGE_JOB]: DAILY_UPDATE_NUDGE_JOB_TYPE,
        [DOCUMENT_EMBED_JOB]: DOCUMENT_EMBED_JOB_TYPE,
        [DOCUMENT_TRANSCRIPT_JOB]: DOCUMENT_TRANSCRIPT_JOB_TYPE,
        [ACTIVITY_ATTRIBUTE_JOB]: ACTIVITY_ATTRIBUTE_JOB_TYPE,
      },
    });
    const runner = createJobRunner({
      role: "worker",
      jobs,
      handlers: {
        [DUE_REMINDER_JOB]: handleDueReminderJob,
        [STALE_TIMER_JOB]: handleStaleTimerJob,
        [DAILY_UPDATE_NUDGE_JOB]: handleDailyUpdateNudgeJob,
        [DOCUMENT_EMBED_JOB]: handleDocumentEmbedJob,
        [DOCUMENT_TRANSCRIPT_JOB]: handleDocumentTranscriptJob,
        [ACTIVITY_ATTRIBUTE_JOB]: handleAttributeEvidenceJob,
      },
      claimerId,
    });
    const schedulers = [
      createDueReminderScheduler({ role: "worker", jobs, holderId: claimerId }),
      createStaleTimerScheduler({ role: "worker", jobs, holderId: claimerId }),
      createDailyUpdateNudgeScheduler({ role: "worker", jobs, holderId: claimerId }),
    ];

    let lastTick = 0;
    while (!stopped) {
      const now = Date.now();
      if (now - lastTick >= tickEveryMs) {
        for (const scheduler of schedulers) {
          await scheduler.tick();
        }
        lastTick = now;
      }
      while (!stopped) {
        const ran = await runner.runOne();
        if (!ran) break;
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  })();

  return {
    stop() {
      stopped = true;
    },
    running,
  };
}

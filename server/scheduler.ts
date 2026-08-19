/**
 * Lease-elected scheduler ticks (#83, #84, ADR-0013). Only a Worker holds a
 * lease; holding it expands work into occurrence-keyed Jobs. HTTP never ticks
 * these schedulers — it may still run the same work on its own interval.
 */

import { eq, lte, or } from "drizzle-orm";
import { schedulerLeases } from "@shared/schema";
import { db } from "./db";
import {
  DUE_REMINDER_JOB,
  dueReminderOccurrenceKey,
} from "./dueReminders";
import { enqueueDailyUpdateNudgeJobs } from "./dailyUpdateNudge";
import { enqueueStaleTimerJobs } from "./staleTimer";
import type { JobsPort } from "./jobs";
import { workspaceOfCause } from "./jobs";
import type { ProcessRole } from "./config";
import { storage } from "./storage";

const DUE_REMINDERS_LEASE = "due-reminders";
const STALE_TIMER_LEASE = "stale-timer";
const DAILY_UPDATE_NUDGE_LEASE = "daily-update-nudge";
const DEFAULT_LEASE_MS = 90_000;

export interface SchedulerTick {
  /** Enqueues occurrence-keyed Jobs for this schedule. HTTP returns 0. */
  tick(): Promise<number>;
}

export interface CreateSchedulerOptions {
  role: ProcessRole;
  jobs: JobsPort;
  holderId: string;
  now?: () => Date;
  leaseTtlMs?: number;
}

export type DueReminderScheduler = SchedulerTick;
export type CreateDueReminderSchedulerOptions = CreateSchedulerOptions;
export type StaleTimerScheduler = SchedulerTick;
export type DailyUpdateNudgeScheduler = SchedulerTick;

function createLeaseElectedTick(
  options: CreateSchedulerOptions,
  leaseName: string,
  expand: (at: Date) => Promise<number>
): SchedulerTick {
  const clock = options.now ?? (() => new Date());
  const leaseTtlMs = options.leaseTtlMs ?? DEFAULT_LEASE_MS;

  return {
    async tick() {
      if (options.role !== "worker") return 0;
      const at = clock();
      if (!(await tryAcquireLease(leaseName, options.holderId, leaseTtlMs, at))) {
        return 0;
      }
      return expand(at);
    },
  };
}

export function createDueReminderScheduler(
  options: CreateDueReminderSchedulerOptions
): DueReminderScheduler {
  return createLeaseElectedTick(options, DUE_REMINDERS_LEASE, async (at) => {
    const due = await storage.getPendingDueReminders(at);
    let created = 0;
    for (const reminder of due) {
      const enqueued = await options.jobs.enqueue({
        type: DUE_REMINDER_JOB,
        payload: { reminderId: reminder.id },
        occurrenceKey: dueReminderOccurrenceKey(reminder.id),
        workspaceId: workspaceOfCause(reminder.workspaceId),
      });
      if (enqueued.created) created += 1;
    }
    return created;
  });
}

export function createStaleTimerScheduler(
  options: CreateSchedulerOptions
): StaleTimerScheduler {
  return createLeaseElectedTick(options, STALE_TIMER_LEASE, (at) =>
    enqueueStaleTimerJobs(options.jobs, at)
  );
}

export function createDailyUpdateNudgeScheduler(
  options: CreateSchedulerOptions
): DailyUpdateNudgeScheduler {
  return createLeaseElectedTick(options, DAILY_UPDATE_NUDGE_LEASE, (at) =>
    enqueueDailyUpdateNudgeJobs(options.jobs, at)
  );
}

async function tryAcquireLease(
  name: string,
  holder: string,
  ttlMs: number,
  now: Date
): Promise<boolean> {
  const expiresAt = new Date(now.getTime() + ttlMs);
  const [row] = await db
    .insert(schedulerLeases)
    .values({ name, holder, expiresAt })
    .onConflictDoUpdate({
      target: schedulerLeases.name,
      set: { holder, expiresAt },
      setWhere: or(lte(schedulerLeases.expiresAt, now), eq(schedulerLeases.holder, holder)),
    })
    .returning({ name: schedulerLeases.name });
  return row !== undefined;
}

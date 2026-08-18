/**
 * Lease-elected due-reminder tick (#83, ADR-0013). Only a Worker holds the
 * lease; holding it expands due reminders into occurrence-keyed Jobs. HTTP
 * never ticks this scheduler — it may still deliver on its own interval.
 */

import { eq, lte, or } from "drizzle-orm";
import { schedulerLeases } from "@shared/schema";
import { db } from "./db";
import {
  DUE_REMINDER_JOB,
  dueReminderOccurrenceKey,
} from "./dueReminders";
import type { JobsPort } from "./jobs";
import type { ProcessRole } from "./config";
import { storage } from "./storage";

const DUE_REMINDERS_LEASE = "due-reminders";
const DEFAULT_LEASE_MS = 90_000;

export interface DueReminderScheduler {
  /** Enqueues one Job per still-pending due reminder. HTTP returns 0. */
  tick(): Promise<number>;
}

export interface CreateDueReminderSchedulerOptions {
  role: ProcessRole;
  jobs: JobsPort;
  holderId: string;
  now?: () => Date;
  leaseTtlMs?: number;
}

export function createDueReminderScheduler(
  options: CreateDueReminderSchedulerOptions
): DueReminderScheduler {
  const clock = options.now ?? (() => new Date());
  const leaseTtlMs = options.leaseTtlMs ?? DEFAULT_LEASE_MS;

  return {
    async tick() {
      if (options.role !== "worker") return 0;
      const at = clock();
      if (!(await tryAcquireLease(DUE_REMINDERS_LEASE, options.holderId, leaseTtlMs, at))) {
        return 0;
      }

      const due = await storage.getPendingDueReminders(at);
      let created = 0;
      for (const reminder of due) {
        const enqueued = await options.jobs.enqueue({
          type: DUE_REMINDER_JOB,
          payload: { reminderId: reminder.id },
          occurrenceKey: dueReminderOccurrenceKey(reminder.id),
        });
        if (enqueued.created) created += 1;
      }
      return created;
    },
  };
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

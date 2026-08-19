/**
 * The jobs port: enqueue a Job in the same transaction as the write that
 * caused it, claim it with skip-locked semantics, complete it, or fail it
 * into a retry / Dead Letter. ADR-0013; the test seam is this module (#82).
 *
 * HTTP never claims. Only a Worker does (#83). This file is the queue.
 */

import { and, eq, gt, isNotNull, isNull, sql } from "drizzle-orm";
import { deadLetters, jobs, concurrencyClassValues, SEEDED_WORKSPACE_ID, type ConcurrencyClass, type JobRow } from "@shared/schema";
import type { Db } from "./db";

export type { ConcurrencyClass };

export interface JobTypeDeclaration {
  attempts: number;
  backoffMs: number;
  timeoutMs: number;
  concurrencyClass: ConcurrencyClass;
}

export interface EnqueueJob {
  type: string;
  payload?: unknown;
  workspaceId?: string | null;
  occurrenceKey?: string | null;
}

/** Workspace of the domain row that caused this Job; the seeded Workspace when the cause has none yet. */
export function workspaceOfCause(workspaceId?: string | null): string {
  return workspaceId ?? SEEDED_WORKSPACE_ID;
}

export interface Job {
  id: string;
  type: string;
  payload: unknown;
  workspaceId: string;
  occurrenceKey: string | null;
  concurrencyClass: ConcurrencyClass;
  attempt: number;
  maxAttempts: number;
  claimedBy: string | null;
}

export interface EnqueuedJob extends Job {
  created: boolean;
}

export interface DeadLetter {
  jobId: string;
  type: string;
  payload: unknown;
  workspaceId: string;
  concurrencyClass: ConcurrencyClass;
  attempts: number;
  maxAttempts: number;
  backoffMs: number;
  timeoutMs: number;
  lastError: string;
  claimedBy: string | null;
  enqueuedAt: Date | string;
  recordedAt: Date | string;
}

/** A Drizzle session that can insert a Job — the caller's transaction, or ours. */
export type JobsWriter = Pick<Db, "insert" | "select">;

export interface JobsPort {
  enqueue(job: EnqueueJob, tx?: JobsWriter): Promise<EnqueuedJob>;
  claim(claimerId: string): Promise<Job | null>;
  complete(jobId: string, claimerId: string): Promise<void>;
  fail(jobId: string, claimerId: string, error: string): Promise<void>;
  deadLetterFor(jobId: string): Promise<DeadLetter | null>;
}

export interface CreateJobsPortOptions {
  db: Db;
  types: Record<string, JobTypeDeclaration>;
  now?: () => Date;
}

const CONCURRENCY_CLASSES: ReadonlySet<string> = new Set(concurrencyClassValues);

export function createJobsPort(options: CreateJobsPortOptions): JobsPort {
  const clock = options.now ?? (() => new Date());
  const types = validateTypes(options.types);
  const { db } = options;

  return {
    async enqueue(input, tx) {
      const declaration = types[input.type];
      if (!declaration) {
        throw new Error(
          `Unknown Job type "${input.type}". Every Job type must declare attempts, backoff, timeout, and concurrency class.`
        );
      }
      const at = clock();
      const writer = tx ?? db;
      const occurrenceKey = input.occurrenceKey ?? null;
      const workspaceId = workspaceOfCause(input.workspaceId);
      const [row] = await writer
        .insert(jobs)
        .values({
          type: input.type,
          payload: input.payload ?? {},
          workspaceId,
          occurrenceKey,
          concurrencyClass: declaration.concurrencyClass,
          attempts: 0,
          maxAttempts: declaration.attempts,
          backoffMs: declaration.backoffMs,
          timeoutMs: declaration.timeoutMs,
          availableAt: at,
          createdAt: at,
        })
        .onConflictDoNothing({ target: [jobs.workspaceId, jobs.occurrenceKey] })
        .returning();
      if (row) return { ...toJob(row), created: true };

      if (!occurrenceKey) {
        throw new Error(`Job type "${input.type}" inserted no row and had no occurrence key to recover.`);
      }
      const [existing] = await writer
        .select()
        .from(jobs)
        .where(and(eq(jobs.occurrenceKey, occurrenceKey), eq(jobs.workspaceId, workspaceId)));
      if (!existing) {
        throw new Error(`Job occurrence "${occurrenceKey}" conflicted but could not be loaded.`);
      }
      return { ...toJob(existing), created: false };
    },

    async claim(claimerId) {
      const at = clock();
      return db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL lock_timeout = '2s'`);
        for (;;) {
          const picked = await tx.execute(sql`
            SELECT id
            FROM jobs
            WHERE completed_at IS NULL
              AND available_at <= ${at}
              AND (claimed_at IS NULL OR claim_expires_at <= ${at})
            ORDER BY available_at ASC, created_at ASC
            FOR UPDATE SKIP LOCKED
            LIMIT 1
          `);
          const id = (picked.rows as { id: string }[])[0]?.id;
          if (!id) return null;

          const [row] = await tx.select().from(jobs).where(eq(jobs.id, id));
          if (row.attempts >= row.maxAttempts) {
            await moveToDeadLetter(
              tx,
              row,
              row.lastError ?? "lease expired after exhausting attempts",
              at
            );
            continue;
          }

          const leaseUntil = new Date(at.getTime() + row.timeoutMs);
          const [claimed] = await tx
            .update(jobs)
            .set({
              claimedAt: at,
              claimExpiresAt: leaseUntil,
              claimedBy: claimerId,
              attempts: sql`${jobs.attempts} + 1`,
            })
            .where(eq(jobs.id, id))
            .returning();
          return toJob(claimed);
        }
      });
    },

    async complete(jobId, claimerId) {
      const at = clock();
      const [row] = await db
        .update(jobs)
        .set({ completedAt: at })
        .where(inFlight(jobId, claimerId, at))
        .returning({ id: jobs.id });
      if (!row) {
        throw new Error(
          `Job "${jobId}" is not an in-flight claim of "${claimerId}", so it cannot be completed.`
        );
      }
    },

    async fail(jobId, claimerId, error) {
      const at = clock();
      await db.transaction(async (tx) => {
        const locked = await tx.execute(sql`
          SELECT id
          FROM jobs
          WHERE id = ${jobId}
            AND claimed_by = ${claimerId}
            AND completed_at IS NULL
            AND claimed_at IS NOT NULL
            AND claim_expires_at > ${at}
          FOR UPDATE
        `);
        if ((locked.rows as { id: string }[]).length === 0) {
          throw new Error(
            `Job "${jobId}" is not an in-flight claim of "${claimerId}", so it cannot be failed.`
          );
        }
        const [row] = await tx.select().from(jobs).where(eq(jobs.id, jobId));
        if (row.attempts >= row.maxAttempts) {
          await moveToDeadLetter(tx, row, error, at);
          return;
        }
        await tx
          .update(jobs)
          .set({
            claimedAt: null,
            claimExpiresAt: null,
            claimedBy: null,
            lastError: error,
            availableAt: new Date(at.getTime() + row.backoffMs),
          })
          .where(eq(jobs.id, jobId));
      });
    },

    async deadLetterFor(jobId) {
      const [row] = await db.select().from(deadLetters).where(eq(deadLetters.jobId, jobId));
      if (!row) return null;
      return {
        jobId: row.jobId,
        type: row.type,
        payload: row.payload,
        workspaceId: row.workspaceId,
        concurrencyClass: row.concurrencyClass as ConcurrencyClass,
        attempts: row.attempts,
        maxAttempts: row.maxAttempts,
        backoffMs: row.backoffMs,
        timeoutMs: row.timeoutMs,
        lastError: row.lastError,
        claimedBy: row.claimedBy,
        enqueuedAt: row.enqueuedAt,
        recordedAt: row.recordedAt,
      };
    },
  };
}

function inFlight(jobId: string, claimerId: string, at: Date) {
  return and(
    eq(jobs.id, jobId),
    eq(jobs.claimedBy, claimerId),
    isNull(jobs.completedAt),
    isNotNull(jobs.claimedAt),
    gt(jobs.claimExpiresAt, at)
  );
}

async function moveToDeadLetter(
  tx: Pick<Db, "insert" | "delete">,
  row: JobRow,
  error: string,
  at: Date
): Promise<void> {
  await tx.insert(deadLetters).values({
    jobId: row.id,
    type: row.type,
    payload: row.payload,
    workspaceId: row.workspaceId,
    concurrencyClass: row.concurrencyClass,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    backoffMs: row.backoffMs,
    timeoutMs: row.timeoutMs,
    lastError: error,
    claimedBy: row.claimedBy,
    enqueuedAt: row.createdAt,
    recordedAt: at,
  });
  await tx.delete(jobs).where(eq(jobs.id, row.id));
}

function validateTypes(
  types: Record<string, JobTypeDeclaration>
): Record<string, JobTypeDeclaration> {
  const validated: Record<string, JobTypeDeclaration> = {};
  for (const [name, declaration] of Object.entries(types)) {
    if (!CONCURRENCY_CLASSES.has(declaration.concurrencyClass)) {
      throw new Error(
        `Job type "${name}" has unknown concurrency class "${declaration.concurrencyClass}".`
      );
    }
    if (declaration.attempts < 1 || declaration.backoffMs < 0 || declaration.timeoutMs < 1) {
      throw new Error(
        `Job type "${name}" must declare attempts ≥ 1, backoffMs ≥ 0, and timeoutMs ≥ 1.`
      );
    }
    validated[name] = declaration;
  }
  return validated;
}

function toJob(row: JobRow): Job {
  return {
    id: row.id,
    type: row.type,
    payload: row.payload,
    workspaceId: row.workspaceId,
    occurrenceKey: row.occurrenceKey,
    concurrencyClass: row.concurrencyClass as ConcurrencyClass,
    attempt: row.attempts,
    maxAttempts: row.maxAttempts,
    claimedBy: row.claimedBy,
  };
}

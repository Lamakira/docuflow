import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../helpers/db";

/**
 * The jobs port (#82): enqueue, claim, complete, fail, Dead Letter, against
 * the same disposable Postgres the rest of the smoke harness already uses.
 *
 * Spec #81 puts this seam here on purpose — not HTTP, not Worker internals —
 * so the queue can be shown to work before any dispatcher moves onto it.
 * Workspace id is nullable and unused; nothing here seeds a Workspace.
 */

const WORK = "test.work";

const WORK_TYPE = {
  attempts: 3,
  backoffMs: 60_000,
  timeoutMs: 30_000,
  concurrencyClass: "derived-processing" as const,
};

let now = new Date("2026-08-18T12:00:00.000Z");

async function openPort(types: Record<string, typeof WORK_TYPE> = { [WORK]: WORK_TYPE }) {
  const { db } = await import("../../server/db");
  const { createJobsPort } = await import("../../server/jobs");
  return createJobsPort({ db, types, now: () => now });
}

describe("jobs port", () => {
  beforeEach(async () => {
    await resetDb();
    now = new Date("2026-08-18T12:00:00.000Z");
  });

  it("enqueues a Job with no Workspace and lets one caller claim it", async () => {
    const jobs = await openPort();

    const enqueued = await jobs.enqueue({ type: WORK, payload: { reminderId: "r1" } });

    expect(enqueued).toMatchObject({
      type: WORK,
      payload: { reminderId: "r1" },
      workspaceId: null,
      attempt: 0,
    });

    const claimed = await jobs.claim("worker-a");
    expect(claimed).toMatchObject({
      id: enqueued.id,
      type: WORK,
      payload: { reminderId: "r1" },
      workspaceId: null,
      attempt: 1,
      claimedBy: "worker-a",
    });
    expect(await jobs.claim("worker-b")).toBeNull();
  });

  it("does not hand the same in-flight Job to two claimers", async () => {
    const jobs = await openPort();
    await jobs.enqueue({ type: WORK });

    const [a, b] = await Promise.all([jobs.claim("worker-a"), jobs.claim("worker-b")]);
    const claimed = [a, b].filter((job): job is NonNullable<typeof job> => job !== null);

    expect(claimed).toHaveLength(1);
    expect(await jobs.claim("worker-c")).toBeNull();
  });

  it("skips a Job another transaction has already locked", async () => {
    const jobs = await openPort();
    await jobs.enqueue({ type: WORK });

    const { Client } = await import("pg");
    const locker = new Client({ connectionString: process.env.DATABASE_URL });
    await locker.connect();
    await locker.query("BEGIN");
    await locker.query("SELECT id FROM jobs FOR UPDATE SKIP LOCKED LIMIT 1");
    try {
      expect(await jobs.claim("worker-b")).toBeNull();
    } finally {
      await locker.query("ROLLBACK");
      await locker.end();
    }
  });

  it("lets a crashed claim be claimed again after its lease", async () => {
    const jobs = await openPort();
    const enqueued = await jobs.enqueue({ type: WORK });

    expect((await jobs.claim("worker-a"))?.id).toBe(enqueued.id);

    now = new Date(now.getTime() + WORK_TYPE.timeoutMs + 1);
    expect(await jobs.claim("worker-b")).toMatchObject({
      id: enqueued.id,
      attempt: 2,
      claimedBy: "worker-b",
    });
  });

  it("does not let a completed Job be claimed again, even after its lease would have expired", async () => {
    const jobs = await openPort();
    const enqueued = await jobs.enqueue({ type: WORK });
    const claimed = await jobs.claim("worker-a");

    await jobs.complete(claimed!.id, "worker-a");

    expect(await jobs.claim("worker-b")).toBeNull();
    now = new Date(now.getTime() + WORK_TYPE.timeoutMs + 1);
    expect(await jobs.claim("worker-b")).toBeNull();
    expect(enqueued.id).toBe(claimed!.id);
  });

  it("retries after fail only once the declared backoff elapses", async () => {
    const jobs = await openPort();
    const enqueued = await jobs.enqueue({ type: WORK, payload: { n: 1 } });
    const claimed = await jobs.claim("worker-a");

    await jobs.fail(claimed!.id, "worker-a", "delivery timed out");

    expect(await jobs.claim("worker-b")).toBeNull();
    now = new Date(now.getTime() + WORK_TYPE.backoffMs);
    expect(await jobs.claim("worker-b")).toMatchObject({
      id: enqueued.id,
      attempt: 2,
      claimedBy: "worker-b",
    });
  });

  it("moves a Job that has exhausted its attempts to a Dead Letter with provenance", async () => {
    const jobs = await openPort({
      [WORK]: { ...WORK_TYPE, attempts: 2, backoffMs: 0 },
    });
    const enqueued = await jobs.enqueue({
      type: WORK,
      payload: { reminderId: "r-dead" },
      workspaceId: null,
    });

    const first = await jobs.claim("worker-a");
    await jobs.fail(first!.id, "worker-a", "in-app channel down");
    const second = await jobs.claim("worker-a");
    await jobs.fail(second!.id, "worker-a", "email rejected");

    expect(await jobs.claim("worker-b")).toBeNull();
    expect(await jobs.deadLetterFor(enqueued.id)).toMatchObject({
      jobId: enqueued.id,
      type: WORK,
      payload: { reminderId: "r-dead" },
      workspaceId: null,
      concurrencyClass: "derived-processing",
      attempts: 2,
      maxAttempts: 2,
      lastError: "email rejected",
      claimedBy: "worker-a",
    });
  });

  it("dead-letters a Job whose last claim crashed rather than looping it", async () => {
    const jobs = await openPort({ [WORK]: { ...WORK_TYPE, attempts: 1 } });
    const enqueued = await jobs.enqueue({ type: WORK, payload: { x: 1 } });
    await jobs.claim("worker-a");

    now = new Date(now.getTime() + WORK_TYPE.timeoutMs + 1);

    expect(await jobs.claim("worker-b")).toBeNull();
    expect(await jobs.deadLetterFor(enqueued.id)).toMatchObject({
      jobId: enqueued.id,
      payload: { x: 1 },
      attempts: 1,
    });
  });

  it("rolls back an enqueued Job together with the caller-provided write", async () => {
    const { db } = await import("../../server/db");
    const { users } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    const jobs = await openPort();
    const email = "jobs-rollback@test.invalid";

    await expect(
      db.transaction(async (tx) => {
        await tx.insert(users).values({ email, password: "not-a-real-hash" });
        await jobs.enqueue({ type: WORK, payload: { marker: true } }, tx);
        tx.rollback();
      })
    ).rejects.toThrow();

    expect(await jobs.claim("worker-a")).toBeNull();
    expect(await db.select({ id: users.id }).from(users).where(eq(users.email, email))).toEqual([]);
  });
});

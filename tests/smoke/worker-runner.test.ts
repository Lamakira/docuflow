import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../helpers/db";

/**
 * The Worker runner (#83). The jobs port owns claim/fail semantics and is
 * covered in `jobs.test.ts`; what is covered here is the loop that drives it,
 * because a Worker that dies stops claiming every other Job too.
 */

const WORK = "test.work";

const WORK_TYPE = {
  attempts: 3,
  backoffMs: 60_000,
  timeoutMs: 30_000,
  concurrencyClass: "derived-processing" as const,
};

let now = new Date("2026-09-16T12:00:00.000Z");

async function openRunner(handler: () => Promise<void>) {
  const { db } = await import("../../server/db");
  const { createJobsPort } = await import("../../server/jobs");
  const { createJobRunner } = await import("../../server/worker");
  const jobs = createJobsPort({ db, types: { [WORK]: WORK_TYPE }, now: () => now });
  const runner = createJobRunner({
    role: "worker",
    jobs,
    handlers: { [WORK]: handler },
    claimerId: "worker-1",
  });
  return { jobs, runner };
}

describe("Worker runner", () => {
  beforeEach(async () => {
    await resetDb();
    now = new Date("2026-09-16T12:00:00.000Z");
  });

  it("survives a handler that outruns its lease and then throws", async () => {
    const { jobs, runner } = await openRunner(async () => {
      now = new Date(now.getTime() + WORK_TYPE.timeoutMs + 1_000);
      throw new Error("handler blew up after its lease expired");
    });
    await jobs.enqueue({ type: WORK, payload: { n: 1 } });

    // `fail` refuses a claim that is no longer in flight. That refusal belongs
    // to this one Job and must not escape the runner.
    await expect(runner.runOne()).resolves.not.toBeNull();
  });

  it("leaves the Job claimable after losing the race, rather than dropping it", async () => {
    const { jobs, runner } = await openRunner(async () => {
      now = new Date(now.getTime() + WORK_TYPE.timeoutMs + 1_000);
      throw new Error("handler blew up after its lease expired");
    });
    const enqueued = await jobs.enqueue({ type: WORK, payload: { n: 1 } });

    await runner.runOne();

    const reclaimed = await jobs.claim("worker-2");
    expect(reclaimed?.id).toBe(enqueued.id);
  });

  it("still fails a Job normally when the claim is still in flight", async () => {
    const { jobs, runner } = await openRunner(async () => {
      throw new Error("handler blew up inside its lease");
    });
    const enqueued = await jobs.enqueue({ type: WORK, payload: { n: 1 } });

    await runner.runOne();

    // Backoff has not elapsed, so the Job is not immediately claimable again.
    expect(await jobs.claim("worker-2")).toBeNull();
    now = new Date(now.getTime() + WORK_TYPE.backoffMs);
    const reclaimed = await jobs.claim("worker-2");
    expect(reclaimed?.id).toBe(enqueued.id);
    expect(reclaimed?.attempt).toBe(2);
  });
});

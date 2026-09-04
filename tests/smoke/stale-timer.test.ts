import { beforeEach, describe, expect, it, vi } from "vitest";
import { SEEDED_WORKSPACE_ID } from "../../shared/schema";
import { resetDb } from "../helpers/db";
import { inSeededWorkspace } from "../helpers/workspace";

/**
 * Stale-timer detection as a Job (#84, spec #81).
 *
 * The seam is the Job handler and the jobs port — not HTTP, not Worker
 * internals. Flag-only policy: a stale running Time Entry is logged and
 * left running. Occurrence key is the check window, so a second tick in
 * the same window does not flag again.
 */

const WINDOW_MS = 2 * 60 * 1000;
const NOW = new Date("2026-08-18T16:00:00.000Z");

async function seedRunningEntry(lastActivityAt: Date) {
  const { storage } = await import("../../server/storage");
  const { inSeededWorkspace } = await import("../helpers/workspace");
  const user = await storage.createUser({
    email: "timer@test.invalid",
    firstName: "Tim",
  });
  return inSeededWorkspace(async () => {
    const { crmProject } = await storage.createCrmProjectWithBase({
      name: "Atlas",
      ownerId: user.id,
    });
    const entry = await storage.createTimeEntry({
      userId: user.id,
      crmProjectId: crmProject.id,
      description: "Still running",
      startTime: lastActivityAt,
      status: "running",
      lastActivityAt,
    });
    return { storage, user, entry };
  });
}

describe("stale-timer Job", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("flags a stale running Time Entry once per check window and does not auto-stop", async () => {
    const lastActivityAt = new Date(NOW.getTime() - 11 * 60 * 1000);
    const { storage, entry } = await seedRunningEntry(lastActivityAt);
    const { db } = await import("../../server/db");
    const { createJobsPort } = await import("../../server/jobs");
    const {
      STALE_TIMER_JOB,
      STALE_TIMER_JOB_TYPE,
      handleStaleTimerJob,
      staleTimerOccurrenceKey,
    } = await import("../../server/staleTimer");
    const { createStaleTimerScheduler } = await import("../../server/scheduler");
    const { createJobRunner } = await import("../../server/worker");

    const jobs = createJobsPort({
      db,
      types: { [STALE_TIMER_JOB]: STALE_TIMER_JOB_TYPE },
    });
    let at = NOW;
    const scheduler = createStaleTimerScheduler({
      role: "worker",
      jobs,
      holderId: "worker-1",
      now: () => at,
    });
    const http = createStaleTimerScheduler({
      role: "http",
      jobs,
      holderId: "http-1",
      now: () => at,
    });
    const worker = createJobRunner({
      role: "worker",
      jobs,
      handlers: { [STALE_TIMER_JOB]: handleStaleTimerJob },
      claimerId: "worker-1",
    });

    const warnings: string[] = [];
    const warn = vi.spyOn(console, "warn").mockImplementation((msg) => {
      warnings.push(String(msg));
    });

    expect(await http.tick()).toBe(0);
    expect(await scheduler.tick()).toBe(1);
    expect(await scheduler.tick()).toBe(0);

    expect(await worker.runOne()).toMatchObject({
      type: STALE_TIMER_JOB,
      payload: { entryId: entry.id },
      occurrenceKey: staleTimerOccurrenceKey(entry.id, at),
      workspaceId: SEEDED_WORKSPACE_ID,
      claimedBy: "worker-1",
    });

    const afterFirst = await inSeededWorkspace(() => storage.getTimeEntry(entry.id));
    expect(afterFirst).toMatchObject({
      status: "running",
      endTime: null,
    });
    expect(warnings.filter((line) => line.includes("time-tracking.stale-session"))).toHaveLength(1);

    at = new Date(NOW.getTime() + WINDOW_MS / 2);
    expect(await scheduler.tick()).toBe(0);
    expect(await worker.runOne()).toBeNull();

    at = new Date(NOW.getTime() + WINDOW_MS);
    expect(await scheduler.tick()).toBe(1);
    expect(await worker.runOne()).toMatchObject({
      type: STALE_TIMER_JOB,
      occurrenceKey: staleTimerOccurrenceKey(entry.id, at),
    });

    const afterSecond = await inSeededWorkspace(() => storage.getTimeEntry(entry.id));
    expect(afterSecond).toMatchObject({ status: "running", endTime: null });
    expect(warnings.filter((line) => line.includes("time-tracking.stale-session"))).toHaveLength(2);

    warn.mockRestore();
  });
});

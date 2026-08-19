import { beforeEach, describe, expect, it } from "vitest";
import { SEEDED_WORKSPACE_ID } from "../../shared/schema";
import { resetDb } from "../helpers/db";
import { sentEmails } from "../fakes/resend";

/**
 * Daily Update nudge as a Job (#84, spec #81).
 *
 * The seam is the Job handler and the jobs port — not HTTP, not Worker
 * internals. The occurrence key is the Workday (America/Toronto calendar
 * day), so a retry the same day does not double-nudge.
 */

/** 6:00 PM America/Toronto on 18 Aug 2026 (EDT, UTC−4). */
const SIX_PM = new Date("2026-08-18T22:00:00.000Z");
/** 5:00 PM the same Workday — too early to nudge. */
const FIVE_PM = new Date("2026-08-18T21:00:00.000Z");
const WORKDAY = "2026-08-18";

async function seedMember(email = "ada@test.invalid") {
  const { storage } = await import("../../server/storage");
  const user = await storage.createUser({
    email,
    password: "not-a-real-hash",
    firstName: "Ada",
  });
  return { storage, user };
}

describe("Daily Update nudge Job", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("nudges a member without today's Daily Update once per Workday", async () => {
    const { storage, user } = await seedMember();
    const { db } = await import("../../server/db");
    const { createJobsPort } = await import("../../server/jobs");
    const {
      DAILY_UPDATE_NUDGE_JOB,
      DAILY_UPDATE_NUDGE_JOB_TYPE,
      dailyUpdateNudgeOccurrenceKey,
      handleDailyUpdateNudgeJob,
    } = await import("../../server/dailyUpdateNudge");
    const { createDailyUpdateNudgeScheduler } = await import("../../server/scheduler");
    const { createJobRunner } = await import("../../server/worker");

    const jobs = createJobsPort({
      db,
      types: { [DAILY_UPDATE_NUDGE_JOB]: DAILY_UPDATE_NUDGE_JOB_TYPE },
    });
    let at = SIX_PM;
    const scheduler = createDailyUpdateNudgeScheduler({
      role: "worker",
      jobs,
      holderId: "worker-1",
      now: () => at,
    });
    const http = createDailyUpdateNudgeScheduler({
      role: "http",
      jobs,
      holderId: "http-1",
      now: () => at,
    });
    const worker = createJobRunner({
      role: "worker",
      jobs,
      handlers: { [DAILY_UPDATE_NUDGE_JOB]: handleDailyUpdateNudgeJob },
      claimerId: "worker-1",
    });

    at = FIVE_PM;
    expect(await scheduler.tick()).toBe(0);

    at = SIX_PM;
    expect(await http.tick()).toBe(0);
    expect(await scheduler.tick()).toBe(1);
    expect(await scheduler.tick()).toBe(0);

    expect(await worker.runOne()).toMatchObject({
      type: DAILY_UPDATE_NUDGE_JOB,
      payload: { userId: user.id, workday: WORKDAY },
      occurrenceKey: dailyUpdateNudgeOccurrenceKey(user.id, WORKDAY),
      workspaceId: SEEDED_WORKSPACE_ID,
      claimedBy: "worker-1",
    });

    const first = await storage.getUserNotifications(user.id);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      type: "daily_update_reminder",
      message: "Don't forget to submit your daily update before you finish your day.",
    });
    expect(sentEmails()).toEqual([
      expect.objectContaining({
        to: "ada@test.invalid",
        subject: "Reminder: submit your daily update",
      }),
    ]);

    await handleDailyUpdateNudgeJob({
      id: "replay",
      type: DAILY_UPDATE_NUDGE_JOB,
      payload: { userId: user.id, workday: WORKDAY },
      workspaceId: null,
      occurrenceKey: dailyUpdateNudgeOccurrenceKey(user.id, WORKDAY),
      concurrencyClass: "external-delivery",
      attempt: 2,
      maxAttempts: 5,
      claimedBy: "worker-1",
    });

    expect(await storage.getUserNotifications(user.id)).toHaveLength(1);
    expect(sentEmails()).toHaveLength(1);
    expect(await worker.runOne()).toBeNull();
  });
});

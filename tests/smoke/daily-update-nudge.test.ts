import { beforeEach, describe, expect, it } from "vitest";
import { SEEDED_WORKSPACE_ID } from "../../shared/schema";
import { resetDb } from "../helpers/db";
import { createSeededMember, inSeededWorkspace } from "../helpers/workspace";
import { sentEmails } from "../fakes/resend";

/**
 * Daily Update nudge as a Job (#84, spec #81).
 *
 * The seam is the Job handler and the jobs port — not HTTP, not Worker
 * internals. The occurrence key is the Workday (the calendar day in the
 * Workspace time zone, America/Toronto until one is set), so a retry the same
 * day does not double-nudge.
 */

/** 6:00 PM America/Toronto on 18 Aug 2026 (EDT, UTC−4). */
const SIX_PM = new Date("2026-08-18T22:00:00.000Z");
/** 5:00 PM the same Workday — too early to nudge. */
const FIVE_PM = new Date("2026-08-18T21:00:00.000Z");
const WORKDAY = "2026-08-18";

async function seedMember(email = "ada@test.invalid") {
  const { storage } = await import("../../server/storage");
  const user = await createSeededMember({
    email,
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

    const first = await inSeededWorkspace(() => storage.getUserNotifications(user.id));
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

    await inSeededWorkspace(() =>
      handleDailyUpdateNudgeJob({
        id: "replay",
        type: DAILY_UPDATE_NUDGE_JOB,
        payload: { userId: user.id, workday: WORKDAY },
        workspaceId: SEEDED_WORKSPACE_ID,
        occurrenceKey: dailyUpdateNudgeOccurrenceKey(user.id, WORKDAY),
        concurrencyClass: "external-delivery",
        attempt: 2,
        maxAttempts: 5,
        claimedBy: "worker-1",
      })
    );

    expect(await inSeededWorkspace(() => storage.getUserNotifications(user.id))).toHaveLength(1);
    expect(sentEmails()).toHaveLength(1);
    expect(await worker.runOne()).toBeNull();
  });

  it("skips email when reminders Delivery Preference is off, and still writes the inbox", async () => {
    const { storage, user } = await seedMember();
    const { putDeliveryPreference } = await import("../../server/modules/notifications/deliveryPreference");
    const { nudgeMemberForWorkday } = await import("../../server/dailyUpdateNudge");

    await inSeededWorkspace(() => putDeliveryPreference(user.id, { reminders: false }));
    expect(await inSeededWorkspace(() => nudgeMemberForWorkday(user.id, WORKDAY))).toBe(true);

    expect(await inSeededWorkspace(() => storage.getUserNotifications(user.id))).toHaveLength(1);
    expect(sentEmails()).toEqual([]);
  });

  it("nudges a Europe/Paris Workspace at 18:00 Paris time, not at 18:00 Toronto time", async () => {
    const { user } = await seedMember();
    const { upsertWorkspaceTimeZone } = await import("../../server/modules/time");
    const { nudgeMembersMissingDailyUpdate } = await import("../../server/dailyUpdateNudge");
    await inSeededWorkspace(() => upsertWorkspaceTimeZone("Europe/Paris"));

    // 18:00 Toronto is already 00:00 the next day in Paris.
    expect(await nudgeMembersMissingDailyUpdate(SIX_PM)).toBe(0);
    // 17:59 Paris.
    expect(await nudgeMembersMissingDailyUpdate(new Date("2026-08-18T15:59:00.000Z"))).toBe(0);
    // 18:00 Paris is noon in Toronto.
    expect(await nudgeMembersMissingDailyUpdate(new Date("2026-08-18T16:00:00.000Z"))).toBe(1);

    const { storage } = await import("../../server/storage");
    expect(await inSeededWorkspace(() => storage.getUserNotifications(user.id))).toHaveLength(1);
  });

  it("skips a Workspace per Workspace in the HTTP fast-path set", async () => {
    await seedMember();
    const { nudgeMembersMissingDailyUpdate } = await import("../../server/dailyUpdateNudge");
    const done = new Set<string>();

    expect(await nudgeMembersMissingDailyUpdate(SIX_PM, done)).toBe(1);
    expect(done.has(`${SEEDED_WORKSPACE_ID}:${WORKDAY}`)).toBe(true);
    expect(await nudgeMembersMissingDailyUpdate(SIX_PM, done)).toBe(0);
  });

  it("keys the Workday on the Workspace zone, not Toronto's calendar day", async () => {
    const { user } = await seedMember();
    const { db } = await import("../../server/db");
    const { createJobsPort } = await import("../../server/jobs");
    const { DAILY_UPDATE_NUDGE_JOB, DAILY_UPDATE_NUDGE_JOB_TYPE, dailyUpdateNudgeOccurrenceKey } =
      await import("../../server/dailyUpdateNudge");
    const { createDailyUpdateNudgeScheduler } = await import("../../server/scheduler");
    const { upsertWorkspaceTimeZone } = await import("../../server/modules/time");
    await inSeededWorkspace(() => upsertWorkspaceTimeZone("Pacific/Honolulu"));

    const jobs = createJobsPort({
      db,
      types: { [DAILY_UPDATE_NUDGE_JOB]: DAILY_UPDATE_NUDGE_JOB_TYPE },
    });
    // 18:30 on 18 Aug in Honolulu (UTC−10); 00:30 on 19 Aug in Toronto.
    const scheduler = createDailyUpdateNudgeScheduler({
      role: "worker",
      jobs,
      holderId: "worker-1",
      now: () => new Date("2026-08-19T04:30:00.000Z"),
    });
    expect(await scheduler.tick()).toBe(1);

    const claimed = await jobs.claim("worker-1");
    expect(claimed).toMatchObject({
      payload: { userId: user.id, workday: "2026-08-18" },
      occurrenceKey: dailyUpdateNudgeOccurrenceKey(user.id, "2026-08-18"),
    });
  });
});

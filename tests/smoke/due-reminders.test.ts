import { beforeEach, describe, expect, it } from "vitest";
import { SEEDED_WORKSPACE_ID } from "../../shared/schema";
import { resetDb } from "../helpers/db";
import { inSeededWorkspace } from "../helpers/workspace";
import { sentEmails } from "../fakes/resend";

/**
 * Due-reminder delivery as a Job (#83, spec #81).
 *
 * The seam is the Job handler and the jobs port — not HTTP, not Worker
 * internals. Email goes through the existing Resend fake; in-app notifications
 * are observed through storage the same way a member would retrieve them.
 */

async function seedDueReminder() {
  const { storage } = await import("../../server/storage");
  const { inSeededWorkspace } = await import("../helpers/workspace");
  const user = await storage.createUser({
    email: "ada@test.invalid",
    firstName: "Ada",
  });
  return inSeededWorkspace(async () => {
    const { crmProject } = await storage.createCrmProjectWithBase({
      name: "Atlas",
      ownerId: user.id,
    });
    const reminder = await storage.createReminder({
      userId: user.id,
      crmProjectId: crmProject.id,
      title: "Call the client",
      note: "About the invoice",
      dueAt: new Date("2026-08-18T11:00:00.000Z"),
    });
    return { storage, user, crmProject, reminder };
  });
}

describe("due-reminder Job", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("creates the in-app notification and fakes email; a second run does not duplicate a marked channel", async () => {
    const { storage, user, reminder } = await seedDueReminder();
    const { db } = await import("../../server/db");
    const { createJobsPort } = await import("../../server/jobs");
    const {
      DUE_REMINDER_JOB,
      DUE_REMINDER_JOB_TYPE,
      handleDueReminderJob,
      deliverDueReminder,
    } = await import("../../server/dueReminders");
    const { createJobRunner } = await import("../../server/worker");

    const jobs = createJobsPort({
      db,
      types: { [DUE_REMINDER_JOB]: DUE_REMINDER_JOB_TYPE },
    });
    await jobs.enqueue({
      type: DUE_REMINDER_JOB,
      payload: { reminderId: reminder.id },
      workspaceId: SEEDED_WORKSPACE_ID,
    });

    const worker = createJobRunner({
      role: "worker",
      jobs,
      handlers: { [DUE_REMINDER_JOB]: handleDueReminderJob },
      claimerId: "worker-1",
    });
    expect(await worker.runOne()).toMatchObject({
      type: DUE_REMINDER_JOB,
      claimedBy: "worker-1",
    });

    const first = await inSeededWorkspace(() => storage.getUserNotifications(user.id));
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      type: "reminder",
      crmProjectId: reminder.crmProjectId,
      message: "Reminder: Call the client (Atlas)",
    });
    expect(sentEmails()).toEqual([
      expect.objectContaining({
        to: "ada@test.invalid",
        subject: "DocuFlow Reminder - Call the client",
      }),
    ]);
    expect(await inSeededWorkspace(() => storage.getReminder(reminder.id))).toMatchObject({
      notifiedInApp: 1,
      emailSent: 1,
      notified: 1,
      status: "due",
    });
    expect(await jobs.claim("worker-2")).toBeNull();

    await inSeededWorkspace(() => deliverDueReminder(reminder.id));

    expect(await inSeededWorkspace(() => storage.getUserNotifications(user.id))).toHaveLength(1);
    expect(sentEmails()).toHaveLength(1);
  });

  it("still creates the in-app notification when email fails, and a retry does not duplicate it", async () => {
    const { storage, user, reminder } = await seedDueReminder();
    const { failNextSend } = await import("../fakes/resend");
    const { deliverDueReminder } = await import("../../server/dueReminders");

    failNextSend("email rejected");
    await expect(inSeededWorkspace(() => deliverDueReminder(reminder.id))).rejects.toThrow(/email rejected/);

    expect(await inSeededWorkspace(() => storage.getUserNotifications(user.id))).toHaveLength(1);
    expect(sentEmails()).toHaveLength(0);
    expect(await inSeededWorkspace(() => storage.getReminder(reminder.id))).toMatchObject({
      notifiedInApp: 1,
      emailSent: 0,
      notified: 0,
    });

    await inSeededWorkspace(() => deliverDueReminder(reminder.id));

    expect(await inSeededWorkspace(() => storage.getUserNotifications(user.id))).toHaveLength(1);
    expect(sentEmails()).toHaveLength(1);
    expect(await inSeededWorkspace(() => storage.getReminder(reminder.id))).toMatchObject({
      notifiedInApp: 1,
      emailSent: 1,
      notified: 1,
      status: "due",
    });
  });

  it("a worker-role process claims and runs the Job; an HTTP-role process does not claim", async () => {
    const { reminder } = await seedDueReminder();
    const { db } = await import("../../server/db");
    const { createJobsPort } = await import("../../server/jobs");
    const { DUE_REMINDER_JOB, DUE_REMINDER_JOB_TYPE, handleDueReminderJob } = await import(
      "../../server/dueReminders"
    );
    const { createJobRunner } = await import("../../server/worker");

    const jobs = createJobsPort({
      db,
      types: { [DUE_REMINDER_JOB]: DUE_REMINDER_JOB_TYPE },
    });
    await jobs.enqueue({
      type: DUE_REMINDER_JOB,
      payload: { reminderId: reminder.id },
      workspaceId: SEEDED_WORKSPACE_ID,
    });

    const http = createJobRunner({
      role: "http",
      jobs,
      handlers: { [DUE_REMINDER_JOB]: handleDueReminderJob },
      claimerId: "http-1",
    });
    expect(await http.runOne()).toBeNull();

    const worker = createJobRunner({
      role: "worker",
      jobs,
      handlers: { [DUE_REMINDER_JOB]: handleDueReminderJob },
      claimerId: "worker-1",
    });
    expect(await worker.runOne()).toMatchObject({
      type: DUE_REMINDER_JOB,
      claimedBy: "worker-1",
    });
    expect(sentEmails()).toHaveLength(1);
    expect(await jobs.claim("worker-2")).toBeNull();
  });

  it("a worker tick expands a due reminder into one occurrence-keyed Job", async () => {
    const { reminder } = await seedDueReminder();
    const { db } = await import("../../server/db");
    const { createJobsPort } = await import("../../server/jobs");
    const { DUE_REMINDER_JOB, DUE_REMINDER_JOB_TYPE, dueReminderOccurrenceKey } = await import(
      "../../server/dueReminders"
    );
    const { createDueReminderScheduler } = await import("../../server/scheduler");

    const jobs = createJobsPort({
      db,
      types: { [DUE_REMINDER_JOB]: DUE_REMINDER_JOB_TYPE },
    });
    const now = new Date("2026-08-18T12:00:00.000Z");
    const worker = createDueReminderScheduler({
      role: "worker",
      jobs,
      holderId: "worker-1",
      now: () => now,
    });
    const http = createDueReminderScheduler({
      role: "http",
      jobs,
      holderId: "http-1",
      now: () => now,
    });

    expect(await http.tick()).toBe(0);
    expect(await worker.tick()).toBe(1);
    expect(await worker.tick()).toBe(0);

    const claimed = await jobs.claim("worker-1");
    expect(claimed).toMatchObject({
      type: DUE_REMINDER_JOB,
      payload: { reminderId: reminder.id },
      occurrenceKey: dueReminderOccurrenceKey(reminder.id),
      workspaceId: SEEDED_WORKSPACE_ID,
    });
    expect(await jobs.claim("worker-2")).toBeNull();
  });
});

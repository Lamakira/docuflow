/**
 * Daily Update nudge (#84). After 6pm America/Toronto, a member who has not
 * submitted today's Daily Update is nudged in-app and by email. The occurrence
 * key is the Workday, so a retry the same day does not double-nudge. The HTTP
 * interval and the Worker Job both call this.
 */

import { config } from "./config";
import { sendDailyUpdateReminderEmail } from "./email";
import type { Job, JobTypeDeclaration, JobsPort } from "./jobs";
import { storage } from "./storage";

export const DAILY_UPDATE_NUDGE_JOB = "daily-update-nudge.deliver";

export const DAILY_UPDATE_NUDGE_JOB_TYPE: JobTypeDeclaration = {
  attempts: 5,
  backoffMs: 60_000,
  timeoutMs: 30_000,
  concurrencyClass: "external-delivery",
};

export const DAILY_UPDATE_NUDGE_TIMEZONE = "America/Toronto";
export const DAILY_UPDATE_NUDGE_HOUR = 18;

export function dailyUpdateNudgeOccurrenceKey(userId: string, workday: string): string {
  return `daily-update-nudge:${userId}:${workday}`;
}

/** Calendar day key ("YYYY-MM-DD") and hour (0–23) in an IANA timezone. */
export function tzDayKeyAndHour(d: Date, timeZone: string): { dayKey: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  let hour = parseInt(get("hour"), 10);
  if (hour === 24) hour = 0;
  return { dayKey: `${get("year")}-${get("month")}-${get("day")}`, hour };
}

function workdayAt(at: Date): { workday: string; hour: number } {
  const { dayKey, hour } = tzDayKeyAndHour(at, DAILY_UPDATE_NUDGE_TIMEZONE);
  return { workday: dayKey, hour };
}

function startOfWorkday(workday: string): Date {
  const [year, month, day] = workday.split("-").map(Number);
  const noonUtc = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const { hour } = tzDayKeyAndHour(noonUtc, DAILY_UPDATE_NUDGE_TIMEZONE);
  return new Date(noonUtc.getTime() - hour * 60 * 60 * 1000);
}

function isOnWorkday(when: Date, workday: string): boolean {
  return workdayAt(when).workday === workday;
}

export async function membersMissingDailyUpdate(at: Date): Promise<{ id: string }[]> {
  const { workday, hour } = workdayAt(at);
  if (hour < DAILY_UPDATE_NUDGE_HOUR) return [];

  const recent = await storage.getProjectDailyUpdatesForAdmin({
    startDate: startOfWorkday(workday),
  });
  const submittedToday = new Set(
    recent.filter((u) => isOnWorkday(new Date(u.updateDate), workday)).map((u) => u.userId),
  );

  return (await storage.getAllUsers()).filter(
    (u) => u.role === "user" && !u.isArchived && !submittedToday.has(u.id),
  );
}

export async function nudgeMemberForWorkday(userId: string, workday: string): Promise<boolean> {
  const user = await storage.getUser(userId);
  if (!user || user.role !== "user" || user.isArchived) return false;

  const since = startOfWorkday(workday);
  const submitted = await storage.getProjectDailyUpdatesForAdmin({
    userId,
    startDate: since,
  });
  if (submitted.some((u) => isOnWorkday(new Date(u.updateDate), workday))) {
    return false;
  }

  if (await storage.hasRecentNotification(userId, "daily_update_reminder", since)) {
    return false;
  }

  await storage.createNotification({
    userId,
    type: "daily_update_reminder",
    message: "Don't forget to submit your daily update before you finish your day.",
  });
  if (user.email) {
    await sendDailyUpdateReminderEmail(user.email, user.firstName || user.email, config.appUrl);
  }
  return true;
}

export async function nudgeMembersMissingDailyUpdate(at: Date): Promise<number> {
  const { workday, hour } = workdayAt(at);
  if (hour < DAILY_UPDATE_NUDGE_HOUR) return 0;

  const members = await membersMissingDailyUpdate(at);
  let sent = 0;
  for (const member of members) {
    try {
      if (await nudgeMemberForWorkday(member.id, workday)) sent += 1;
    } catch (innerErr) {
      console.error("[DailyUpdateNudge] Failed for member", member.id, innerErr);
    }
  }
  return sent;
}

export async function enqueueDailyUpdateNudgeJobs(jobs: JobsPort, at: Date): Promise<number> {
  const members = await membersMissingDailyUpdate(at);
  const { workday } = workdayAt(at);
  let created = 0;
  for (const member of members) {
    const enqueued = await jobs.enqueue({
      type: DAILY_UPDATE_NUDGE_JOB,
      payload: { userId: member.id, workday },
      occurrenceKey: dailyUpdateNudgeOccurrenceKey(member.id, workday),
    });
    if (enqueued.created) created += 1;
  }
  return created;
}

export async function handleDailyUpdateNudgeJob(job: Job): Promise<void> {
  const payload = job.payload as { userId?: unknown; workday?: unknown };
  const userId = payload.userId;
  const workday = payload.workday;
  if (typeof userId !== "string" || userId.length === 0) {
    throw new Error(`Job "${job.id}" is missing a userId.`);
  }
  if (typeof workday !== "string" || workday.length === 0) {
    throw new Error(`Job "${job.id}" is missing a workday.`);
  }
  await nudgeMemberForWorkday(userId, workday);
}

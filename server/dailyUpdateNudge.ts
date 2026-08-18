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

export function dailyUpdateNudgeOccurrenceKey(userId: string, dayKey: string): string {
  return `daily-update-nudge:${userId}:${dayKey}`;
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

function startOfWorkday(dayKey: string, timeZone: string): Date {
  const [year, month, day] = dayKey.split("-").map(Number);
  const noonUtc = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const { hour } = tzDayKeyAndHour(noonUtc, timeZone);
  return new Date(noonUtc.getTime() - hour * 60 * 60 * 1000);
}

export async function membersMissingDailyUpdate(at: Date): Promise<{ id: string }[]> {
  const { dayKey, hour } = tzDayKeyAndHour(at, DAILY_UPDATE_NUDGE_TIMEZONE);
  if (hour < DAILY_UPDATE_NUDGE_HOUR) return [];

  const since = new Date(at.getTime() - 36 * 60 * 60 * 1000);
  const recent = await storage.getProjectDailyUpdatesForAdmin({ startDate: since });
  const submittedToday = new Set(
    recent
      .filter((u) => tzDayKeyAndHour(new Date(u.updateDate), DAILY_UPDATE_NUDGE_TIMEZONE).dayKey === dayKey)
      .map((u) => u.userId),
  );

  return (await storage.getAllUsers()).filter(
    (u) => u.role === "user" && !u.isArchived && !submittedToday.has(u.id),
  );
}

export async function nudgeMemberForWorkday(userId: string, dayKey: string): Promise<boolean> {
  const user = await storage.getUser(userId);
  if (!user || user.role !== "user" || user.isArchived) return false;

  const since = startOfWorkday(dayKey, DAILY_UPDATE_NUDGE_TIMEZONE);
  const submitted = await storage.getProjectDailyUpdatesForAdmin({
    userId,
    startDate: since,
  });
  if (submitted.some((u) => tzDayKeyAndHour(new Date(u.updateDate), DAILY_UPDATE_NUDGE_TIMEZONE).dayKey === dayKey)) {
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
  const { dayKey, hour } = tzDayKeyAndHour(at, DAILY_UPDATE_NUDGE_TIMEZONE);
  if (hour < DAILY_UPDATE_NUDGE_HOUR) return 0;

  const members = await membersMissingDailyUpdate(at);
  let sent = 0;
  for (const member of members) {
    try {
      if (await nudgeMemberForWorkday(member.id, dayKey)) sent += 1;
    } catch (innerErr) {
      console.error("[DailyUpdateNudge] Failed for member", member.id, innerErr);
    }
  }
  return sent;
}

export async function enqueueDailyUpdateNudgeJobs(jobs: JobsPort, at: Date): Promise<number> {
  const members = await membersMissingDailyUpdate(at);
  const { dayKey } = tzDayKeyAndHour(at, DAILY_UPDATE_NUDGE_TIMEZONE);
  let created = 0;
  for (const member of members) {
    const enqueued = await jobs.enqueue({
      type: DAILY_UPDATE_NUDGE_JOB,
      payload: { userId: member.id, dayKey },
      occurrenceKey: dailyUpdateNudgeOccurrenceKey(member.id, dayKey),
    });
    if (enqueued.created) created += 1;
  }
  return created;
}

export async function handleDailyUpdateNudgeJob(job: Job): Promise<void> {
  const payload = job.payload as { userId?: unknown; dayKey?: unknown };
  const userId = payload.userId;
  const dayKey = payload.dayKey;
  if (typeof userId !== "string" || userId.length === 0) {
    throw new Error(`Job "${job.id}" is missing a userId.`);
  }
  if (typeof dayKey !== "string" || dayKey.length === 0) {
    throw new Error(`Job "${job.id}" is missing a dayKey.`);
  }
  await nudgeMemberForWorkday(userId, dayKey);
}

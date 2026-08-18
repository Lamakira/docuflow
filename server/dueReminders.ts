/**
 * Due-reminder delivery (#83). In-app and email channels succeed independently:
 * each is marked only after it works, so a retry does not replay a channel that
 * already did. The HTTP interval and the Worker Job both call this.
 */

import { storage } from "./storage";
import { config } from "./config";
import { sendReminderDueEmail } from "./email";
import type { Job, JobTypeDeclaration } from "./jobs";

export const DUE_REMINDER_JOB = "due-reminder.deliver";

export const DUE_REMINDER_JOB_TYPE: JobTypeDeclaration = {
  attempts: 5,
  backoffMs: 60_000,
  timeoutMs: 30_000,
  concurrencyClass: "external-delivery",
};

export function dueReminderOccurrenceKey(reminderId: string): string {
  return `due-reminder:${reminderId}`;
}

export async function deliverDueReminder(reminderId: string): Promise<void> {
  const reminder = await storage.getReminder(reminderId);
  if (!reminder || reminder.status === "done") return;

  const crmProject = await storage.getCrmProject(reminder.crmProjectId);
  const projectName = crmProject?.project?.name || "your project";

  let inAppDone = reminder.notifiedInApp === 1;
  let emailDone = reminder.emailSent === 1;

  if (!inAppDone) {
    await storage.createNotification({
      userId: reminder.userId,
      type: "reminder",
      crmProjectId: reminder.crmProjectId,
      message: `Reminder: ${reminder.title} (${projectName})`,
    });
    await storage.updateReminder(reminder.id, { notifiedInApp: 1 });
    inAppDone = true;
  }

  if (!emailDone) {
    const user = await storage.getUser(reminder.userId);
    if (user?.email) {
      const recipientName = user.firstName || user.email;
      const emailResult = await sendReminderDueEmail(
        user.email,
        recipientName,
        reminder.title,
        reminder.note,
        projectName,
        config.appUrl,
        reminder.crmProjectId
      );
      if (emailResult?.success) {
        await storage.updateReminder(reminder.id, { emailSent: 1 });
        emailDone = true;
      } else {
        throw new Error(emailResult?.error ?? "email delivery failed");
      }
    } else {
      await storage.updateReminder(reminder.id, { emailSent: 1 });
      emailDone = true;
    }
  }

  if (inAppDone && emailDone && reminder.notified === 0) {
    await storage.updateReminder(reminder.id, { notified: 1, status: "due" });
  }
}

export async function deliverPendingDueReminders(now: Date): Promise<void> {
  const due = await storage.getPendingDueReminders(now);
  for (const reminder of due) {
    try {
      await deliverDueReminder(reminder.id);
    } catch (innerErr) {
      console.error("[ReminderDispatcher] Failed to dispatch reminder", reminder.id, innerErr);
    }
  }
}

export async function handleDueReminderJob(job: Job): Promise<void> {
  const reminderId = (job.payload as { reminderId?: unknown })?.reminderId;
  if (typeof reminderId !== "string" || reminderId.length === 0) {
    throw new Error(`Job "${job.id}" is missing a reminderId.`);
  }
  await deliverDueReminder(reminderId);
}


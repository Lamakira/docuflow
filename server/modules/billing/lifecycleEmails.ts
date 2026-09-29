/**
 * Lifecycle emails (#298, ADR-0013). A trigger records the Owner's billing
 * notice in the transaction that causes it: the Job that sends the email, and
 * the in-app Notification for every notice but Welcome. A replayed transition
 * records nothing more. Billing notices are mandatory, so no Delivery
 * Preference is read.
 *
 * ADR-0013 routes consequences through Outbox Events and keeps notification
 * rules in the Notifications module. No outbox dispatcher exists yet, so these
 * notices are enqueued and written here, where their causes are.
 */

import { and, eq, isNull } from "drizzle-orm";
import { memberships, notifications, users, workspaceRoles, workspaces } from "@shared/schema";
import { config } from "../../config";
import { db } from "../../db";
import {
  dateInWords,
  sendPaymentFailedEmail,
  sendReadOnlyEmail,
  sendTrialEndingEmail,
  sendWelcomeEmail,
  type BillingEmailRecipient,
  type TrialEndingStage,
} from "../../email";
import {
  createJobsPort,
  workspaceOfCause,
  type Job,
  type JobTypeDeclaration,
  type JobsWriter,
} from "../../jobs";
import { logWarn } from "../../logger";
import { inWorkspace, requireWorkspaceContext, stampWorkspace } from "../../workspaceContext";

export type { TrialEndingStage };

export const BILLING_EMAIL_JOB = "billing.lifecycle-email";

export const BILLING_EMAIL_JOB_TYPE: JobTypeDeclaration = {
  attempts: 5,
  backoffMs: 60_000,
  timeoutMs: 30_000,
  concurrencyClass: "external-delivery",
};

type BillingEmail =
  | { kind: "welcome"; recipientUserId: string; trialEndsAt: string; trialDays: number }
  | { kind: "trial-ending"; recipientUserId: string; stage: TrialEndingStage; trialEndsAt: string }
  | { kind: "read-only"; recipientUserId: string; reason: string }
  | { kind: "payment-failed"; recipientUserId: string; nextAttemptAt: string | null };

type Notice = {
  email: BillingEmail;
  /** Absent for Welcome, which has no in-app counterpart. */
  notification?: { type: string; message: string };
};

const billingEmailJobs = createJobsPort({
  db,
  types: { [BILLING_EMAIL_JOB]: BILLING_EMAIL_JOB_TYPE },
});

/**
 * The Owner, and only the Owner. `workspaceOwnerUserId()` falls back to any
 * Member when there is none, which would send billing facts to a Member.
 */
async function activeOwnerUserId(tx: JobsWriter): Promise<string | null> {
  const [owner] = await tx
    .select({ userId: memberships.userId })
    .from(memberships)
    .innerJoin(workspaceRoles, eq(memberships.workspaceRoleId, workspaceRoles.id))
    .where(
      and(inWorkspace(memberships), eq(workspaceRoles.slug, "owner"), isNull(memberships.archivedAt))
    )
    .limit(1);
  return owner?.userId ?? null;
}

/**
 * One billing notice to the Owner, in the caller's transaction: the email Job
 * and its in-app Notification, both or neither. True when it was not already
 * on its way.
 */
async function recordNotice(
  tx: JobsWriter,
  occurrenceKey: string,
  compose: (ownerId: string) => Notice
): Promise<boolean> {
  const ownerId = await activeOwnerUserId(tx);
  if (!ownerId) {
    logWarn("billing.notice_without_owner", {
      workspaceId: requireWorkspaceContext().workspaceId,
      occurrenceKey,
    });
    return false;
  }
  const { email, notification } = compose(ownerId);
  const job = await billingEmailJobs.enqueue(
    {
      type: BILLING_EMAIL_JOB,
      payload: email,
      workspaceId: workspaceOfCause(requireWorkspaceContext().workspaceId),
      occurrenceKey,
    },
    tx
  );
  if (!job.created) return false;
  if (notification) {
    await tx.insert(notifications).values(
      stampWorkspace({ userId: ownerId, type: notification.type, message: notification.message })
    );
  }
  return true;
}

/** Recorded with the Trial that a new Workspace starts on. */
export async function recordWelcomeNotice(
  tx: JobsWriter,
  trialEndsAt: Date,
  trialDays: number
): Promise<boolean> {
  return recordNotice(tx, "billing.email:welcome", (ownerId) => ({
    email: {
      kind: "welcome",
      recipientUserId: ownerId,
      trialEndsAt: trialEndsAt.toISOString(),
      trialDays,
    },
  }));
}

export async function recordTrialEndingNotice(
  stage: TrialEndingStage,
  trialEndsAt: Date
): Promise<boolean> {
  const endsAt = trialEndsAt.toISOString();
  return db.transaction((tx) =>
    recordNotice(tx, `billing.email:trial-ending:${stage}:${endsAt}`, (ownerId) => ({
      email: { kind: "trial-ending", recipientUserId: ownerId, stage, trialEndsAt: endsAt },
      notification: {
        type: "billing_trial_ending",
        message: `Your Trial ends on ${dateInWords(trialEndsAt)}. Choose a Plan to keep full access.`,
      },
    }))
  );
}

/**
 * Every transition into ReadOnly, whatever its reason. The authorization
 * version after the transition names it, so each one is told exactly once.
 */
export async function recordReadOnlyNotice(
  tx: JobsWriter,
  reason: string,
  authorizationVersion: number
): Promise<boolean> {
  return recordNotice(tx, `billing.email:read-only:${authorizationVersion}`, (ownerId) => ({
    email: { kind: "read-only", recipientUserId: ownerId, reason },
    notification: {
      type: "billing_read_only",
      message: "This Workspace is read-only. Its data and exports are kept; choose a Plan to restore full access.",
    },
  }));
}

/** One notice per failed attempt the provider reports, named by its event. */
export async function recordPaymentFailedNotice(
  tx: JobsWriter,
  providerEventId: string,
  nextAttemptAt: Date | null
): Promise<boolean> {
  return recordNotice(tx, `billing.email:payment-failed:${providerEventId}`, (ownerId) => ({
    email: {
      kind: "payment-failed",
      recipientUserId: ownerId,
      nextAttemptAt: nextAttemptAt?.toISOString() ?? null,
    },
    notification: {
      type: "billing_payment_failed",
      message: nextAttemptAt
        ? `A payment failed. We will try again on ${dateInWords(nextAttemptAt)}; update the payment method to keep full access.`
        : "A payment failed and will not be retried. Update the payment method in Billing.",
    },
  }));
}

function isInstant(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

/** The payload with every field its kind reads, or null. */
function billingEmailOf(payload: unknown): BillingEmail | null {
  const email = (payload ?? {}) as Record<string, unknown>;
  if (typeof email.recipientUserId !== "string" || email.recipientUserId.length === 0) return null;
  const complete =
    (email.kind === "welcome" && isInstant(email.trialEndsAt) && typeof email.trialDays === "number") ||
    (email.kind === "trial-ending" &&
      isInstant(email.trialEndsAt) &&
      (email.stage === "three-days" || email.stage === "last-day")) ||
    (email.kind === "read-only" && typeof email.reason === "string") ||
    (email.kind === "payment-failed" && (email.nextAttemptAt === null || isInstant(email.nextAttemptAt)));
  return complete ? (email as unknown as BillingEmail) : null;
}

function sendLifecycleEmail(
  email: BillingEmail,
  recipient: BillingEmailRecipient
): Promise<{ success: boolean; error?: string }> {
  switch (email.kind) {
    case "welcome":
      return sendWelcomeEmail({
        ...recipient,
        trialEndsAt: new Date(email.trialEndsAt),
        trialDays: email.trialDays,
      });
    case "trial-ending":
      return sendTrialEndingEmail({
        ...recipient,
        stage: email.stage,
        trialEndsAt: new Date(email.trialEndsAt),
      });
    case "read-only":
      return sendReadOnlyEmail({ ...recipient, reason: email.reason });
    case "payment-failed":
      return sendPaymentFailedEmail({
        ...recipient,
        nextAttemptAt: email.nextAttemptAt ? new Date(email.nextAttemptAt) : null,
      });
  }
}

export async function handleBillingEmailJob(job: Job): Promise<void> {
  const email = billingEmailOf(job.payload);
  if (!email) {
    throw new Error(`Job "${job.id}" has a malformed billing email payload.`);
  }
  const [user] = await db
    .select({ email: users.email, firstName: users.firstName })
    .from(users)
    .where(eq(users.id, email.recipientUserId))
    .limit(1);
  if (!user?.email) {
    logWarn("billing.email_recipient_missing", { jobId: job.id, kind: email.kind });
    return;
  }
  const { workspaceId } = requireWorkspaceContext();
  const [workspace] = await db
    .select({ name: workspaces.name })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);

  const sent = await sendLifecycleEmail(email, {
    toEmail: user.email,
    recipientName: user.firstName || user.email,
    workspaceName: workspace?.name ?? "your Workspace",
    appUrl: config.appUrl,
  });
  if (!sent.success) {
    throw new Error(`Billing email "${email.kind}" was not sent: ${sent.error}`);
  }
}

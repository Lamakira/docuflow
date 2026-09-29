/**
 * The end of a Trial (#298, ADR-0013), expanded by a lease-elected scheduler
 * tick: the Owner is warned three days before the Trial ends and again in its
 * last 24 hours, and once it has ended a Job makes the Workspace read-only.
 * Occurrence keys make every tick after the first a no-op.
 *
 * Catch-up: a Worker that was down resumes at the current stage and skips the
 * warnings it missed, so an Owner is never told twice in one tick. The warning
 * is a Notification plus an email Job, written by the tick in one transaction
 * rather than enqueued for a later Job to write.
 */

import { workspaceOfCause, type Job, type JobTypeDeclaration, type JobsPort } from "../../jobs";
import { forEachWorkspace, requireWorkspaceContext } from "../../workspaceContext";
import { BillingPinMissingError, getBillingProjection } from "./entitlements";
import { recordTrialEndingNotice, type TrialEndingStage } from "./lifecycleEmails";
import { InvalidBillingTransitionError, expireTrial } from "./stateMachine";

export const BILLING_EXPIRE_TRIAL_JOB = "billing.expire-trial";

export const BILLING_EXPIRE_TRIAL_JOB_TYPE: JobTypeDeclaration = {
  attempts: 5,
  backoffMs: 60_000,
  timeoutMs: 30_000,
  concurrencyClass: "domain-consequence",
};

const DAY_MS = 24 * 60 * 60 * 1000;

function trialEndingStage(trialEndsAt: Date, at: Date): TrialEndingStage | null {
  const remaining = trialEndsAt.getTime() - at.getTime();
  if (remaining <= 0) return null;
  if (remaining <= DAY_MS) return "last-day";
  if (remaining <= 3 * DAY_MS) return "three-days";
  return null;
}

async function trialEndsAt(): Promise<Date | null> {
  try {
    const pin = await getBillingProjection();
    return pin.billingState === "Trialing" ? pin.trialEndsAt : null;
  } catch (error) {
    if (error instanceof BillingPinMissingError) return null;
    throw error;
  }
}

export async function enqueueTrialLifecycleJobs(jobs: JobsPort, at: Date): Promise<number> {
  const counts = await forEachWorkspace(async () => {
    const endsAt = await trialEndsAt();
    if (!endsAt) return 0;
    if (endsAt.getTime() <= at.getTime()) {
      const enqueued = await jobs.enqueue({
        type: BILLING_EXPIRE_TRIAL_JOB,
        occurrenceKey: `billing.expire-trial:${endsAt.toISOString()}`,
        workspaceId: workspaceOfCause(requireWorkspaceContext().workspaceId),
      });
      return enqueued.created ? 1 : 0;
    }
    const stage = trialEndingStage(endsAt, at);
    if (!stage) return 0;
    return (await recordTrialEndingNotice(stage, endsAt)) ? 1 : 0;
  });
  return counts.reduce<number>((sum, n) => sum + n, 0);
}

/** Expiry tells the Owner through the state machine's ReadOnly notice. */
export async function handleExpireTrialJob(_job: Job): Promise<void> {
  try {
    await expireTrial({ kind: "system" });
  } catch (error) {
    // The Trial already ended some other way: a Subscription started, or an
    // earlier run of this Job expired it.
    if (error instanceof InvalidBillingTransitionError) return;
    throw error;
  }
}

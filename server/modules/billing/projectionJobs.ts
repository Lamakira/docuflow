/**
 * Stripe webhook inbox and projection Jobs (#143, ADR-0010, ADR-0013).
 * HTTP verifies, inserts the inbox, and enqueues. The Worker re-fetches
 * through BillingProvider and writes a provider-neutral projection.
 */

import { eq } from "drizzle-orm";
import { auditEvents, billingWebhookInbox } from "@shared/schema";
import { db } from "../../db";
import { config } from "../../config";
import {
  createJobsPort,
  workspaceOfCause,
  type Job,
  type JobTypeDeclaration,
  type JobsPort,
  type JobsWriter,
} from "../../jobs";
import { logWarn } from "../../logger";
import {
  forEachWorkspace,
  requireWorkspaceContext,
  stampWorkspace,
} from "../../workspaceContext";
import {
  BillingProviderClosedError,
  BillingWebhookSignatureError,
  type BillingProvider,
  type WebhookEvent,
} from "./billingProvider";
import { billingProviderFromAppConfig } from "./createBillingProvider";
import { BillingPinMissingError, getBillingProjection } from "./entitlements";
import { applyProviderSubscription, pinAgreesWithSubscription } from "./projection";

export const BILLING_PROJECT_JOB = "billing.project-webhook";
export const BILLING_DRIFT_JOB = "billing.reconcile-drift";

export const BILLING_PROJECT_JOB_TYPE: JobTypeDeclaration = {
  attempts: 5,
  backoffMs: 60_000,
  timeoutMs: 30_000,
  concurrencyClass: "domain-consequence",
};

export const BILLING_DRIFT_JOB_TYPE: JobTypeDeclaration = {
  attempts: 5,
  backoffMs: 60_000,
  timeoutMs: 30_000,
  concurrencyClass: "domain-consequence",
};

const PROJECTABLE_WEBHOOK_TYPES = new Set([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
]);

export class UnknownBillingWebhookError extends Error {
  constructor() {
    super("unknown webhook");
    this.name = "UnknownBillingWebhookError";
  }
}

export type IngestBillingWebhookResult = {
  accepted: true;
  duplicate: boolean;
  enqueued: boolean;
};

export function createBillingJobsPort(): JobsPort {
  return createJobsPort({
    db,
    types: {
      [BILLING_PROJECT_JOB]: BILLING_PROJECT_JOB_TYPE,
      [BILLING_DRIFT_JOB]: BILLING_DRIFT_JOB_TYPE,
    },
  });
}

export function projectWebhookOccurrenceKey(providerEventId: string): string {
  return `billing.project-webhook:${providerEventId}`;
}

export function driftOccurrenceKey(at: Date): string {
  return `billing.drift:${at.toISOString().slice(0, 10)}`;
}

export async function enqueueBillingDriftJobs(jobs: JobsPort, at: Date): Promise<number> {
  const counts = await forEachWorkspace(async () => {
    try {
      const pin = await getBillingProjection();
      if (!pin.stripeSubscriptionId) return 0;
      const enqueued = await jobs.enqueue({
        type: BILLING_DRIFT_JOB,
        occurrenceKey: driftOccurrenceKey(at),
        workspaceId: workspaceOfCause(pin.workspaceId),
      });
      return enqueued.created ? 1 : 0;
    } catch (error) {
      if (error instanceof BillingPinMissingError) return 0;
      throw error;
    }
  });
  return counts.reduce<number>((sum, n) => sum + n, 0);
}

async function workspaceIdForSubscription(objectId: string): Promise<string | null> {
  const matches = await forEachWorkspace(async () => {
    try {
      const pin = await getBillingProjection();
      return pin.stripeSubscriptionId === objectId ? pin.workspaceId : null;
    } catch (error) {
      if (error instanceof BillingPinMissingError) return null;
      throw error;
    }
  });
  return matches.find((id): id is string => id != null) ?? null;
}

/**
 * Verify, inbox-insert, enqueue. Does not re-fetch or apply Entitlements.
 */
export async function ingestBillingWebhook(input: {
  provider: BillingProvider;
  jobs: JobsPort;
  payload: string;
  signature: string;
}): Promise<IngestBillingWebhookResult> {
  let event: WebhookEvent;
  try {
    event = await input.provider.verifyWebhook(input.payload, input.signature);
  } catch (error) {
    if (
      error instanceof BillingWebhookSignatureError ||
      error instanceof BillingProviderClosedError
    ) {
      throw error;
    }
    throw new BillingWebhookSignatureError();
  }
  if (!PROJECTABLE_WEBHOOK_TYPES.has(event.type)) {
    throw new UnknownBillingWebhookError();
  }

  const workspaceId = await workspaceIdForSubscription(event.objectId);

  return db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(billingWebhookInbox)
      .values({
        providerEventId: event.providerEventId,
        type: event.type,
        objectId: event.objectId,
      })
      .onConflictDoNothing()
      .returning({ providerEventId: billingWebhookInbox.providerEventId });

    if (!inserted) {
      return { accepted: true as const, duplicate: true, enqueued: false };
    }
    if (!workspaceId) {
      return { accepted: true as const, duplicate: false, enqueued: false };
    }

    await input.jobs.enqueue(
      {
        type: BILLING_PROJECT_JOB,
        payload: {
          providerEventId: event.providerEventId,
          objectId: event.objectId,
        },
        workspaceId: workspaceOfCause(workspaceId),
        occurrenceKey: projectWebhookOccurrenceKey(event.providerEventId),
      },
      tx as JobsWriter
    );
    return { accepted: true as const, duplicate: false, enqueued: true };
  });
}

export async function handleProjectBillingJob(
  job: Job,
  provider: BillingProvider = billingProviderFromAppConfig(config.billing)
): Promise<void> {
  const payload = job.payload as { providerEventId?: unknown; objectId?: unknown };
  const providerEventId = payload.providerEventId;
  const objectId = payload.objectId;
  if (typeof providerEventId !== "string" || providerEventId.length === 0) {
    throw new Error(`Job "${job.id}" is missing a providerEventId.`);
  }
  if (typeof objectId !== "string" || objectId.length === 0) {
    throw new Error(`Job "${job.id}" is missing an objectId.`);
  }

  const [inbox] = await db
    .select()
    .from(billingWebhookInbox)
    .where(eq(billingWebhookInbox.providerEventId, providerEventId))
    .limit(1);
  if (!inbox) {
    throw new Error(`Job "${job.id}" has no inbox row for "${providerEventId}".`);
  }
  if (inbox.processedAt) return;

  const pin = await getBillingProjection();
  if (!pin.stripeSubscriptionId) {
    await markInboxProcessed(providerEventId);
    return;
  }
  if (pin.stripeSubscriptionId !== objectId) {
    throw new Error(
      `Job "${job.id}" object "${objectId}" does not match this Workspace Subscription.`
    );
  }

  const subscription = await provider.fetchSubscription(objectId);
  await applyProviderSubscription(subscription, { kind: "system" });
  await markInboxProcessed(providerEventId);
}

async function markInboxProcessed(providerEventId: string): Promise<void> {
  await db
    .update(billingWebhookInbox)
    .set({ processedAt: new Date() })
    .where(eq(billingWebhookInbox.providerEventId, providerEventId));
}

export async function handleBillingDriftJob(
  job: Job,
  provider: BillingProvider = billingProviderFromAppConfig(config.billing)
): Promise<void> {
  const pin = await getBillingProjection();
  if (!pin.stripeSubscriptionId) return;

  const subscription = await provider.fetchSubscription(pin.stripeSubscriptionId);
  if (pinAgreesWithSubscription(pin, subscription)) return;

  const { workspaceId } = requireWorkspaceContext();
  await db.insert(auditEvents).values(
    stampWorkspace({
      actorKind: "system",
      actorId: null,
      action: "billing.drift_detected",
      resourceType: "workspace_billing",
      resourceId: workspaceId,
      payload: {
        billingState: pin.billingState,
        collectionState: subscription.collectionState,
        planKey: pin.planKey,
        providerPlanKey: subscription.planKey,
      },
    })
  );
  logWarn("billing.drift", {
    workspaceId,
    jobId: job.id,
    billingState: pin.billingState,
    collectionState: subscription.collectionState,
  });
}

/**
 * Stripe webhook inbox and projection Jobs (#143, ADR-0010, ADR-0013).
 * HTTP verifies, inserts the inbox, and enqueues. The Worker re-fetches
 * through BillingProvider and writes a provider-neutral projection.
 */

import { eq } from "drizzle-orm";
import {
  auditEvents,
  billingPayments,
  billingWebhookInbox,
  paymentDisputes,
  workspaceBilling,
} from "@shared/schema";
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
  inWorkspace,
  requireWorkspaceContext,
  runWithWorkspaceContext,
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
import { recordPaymentFailedNotice } from "./lifecycleEmails";
import { applyProviderSubscription, pinAgreesWithSubscription } from "./projection";
import { applyPendingSeatDecrease } from "./seats";
import {
  recordRejectedSignature,
  recordVerifiedSignature,
  warnIfSecretLooksWrong,
} from "./signatureHealth";

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
  "checkout.session.completed",
]);

/**
 * A failed payment attempt only tells the Owner (#298). It changes no billing
 * state: PastDue still comes from the projection of the Subscription. Both
 * invoice outcomes are recorded for the back office (#314).
 */
const PAYMENT_FAILED_WEBHOOK = "invoice.payment_failed";
const PAYMENT_PAID_WEBHOOK = "invoice.paid";
const PAYMENT_WEBHOOKS = new Set([PAYMENT_FAILED_WEBHOOK, PAYMENT_PAID_WEBHOOK]);

/**
 * Disputes (#314). Managed Payments answers a dispute with the card network, so
 * DocuFlow only records what Stripe reports and runs no Job on it. The latest
 * event's status wins.
 */
const DISPUTE_WEBHOOKS = new Set([
  "charge.dispute.created",
  "charge.dispute.updated",
  "charge.dispute.closed",
  "charge.dispute.funds_withdrawn",
  "charge.dispute.funds_reinstated",
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

async function workspaceIdForCustomer(customerId: string): Promise<string | null> {
  const matches = await forEachWorkspace(async () => {
    try {
      const pin = await getBillingProjection();
      return pin.stripeCustomerId === customerId ? pin.workspaceId : null;
    } catch (error) {
      if (error instanceof BillingPinMissingError) return null;
      throw error;
    }
  });
  return matches.find((id): id is string => id != null) ?? null;
}

async function workspaceIdForPendingCheckout(sessionId: string): Promise<string | null> {
  const matches = await forEachWorkspace(async () => {
    try {
      const [row] = await db
        .select({
          workspaceId: workspaceBilling.workspaceId,
          pendingCheckoutSessionId: workspaceBilling.pendingCheckoutSessionId,
        })
        .from(workspaceBilling)
        .where(inWorkspace(workspaceBilling))
        .limit(1);
      return row?.pendingCheckoutSessionId === sessionId ? row.workspaceId : null;
    } catch (error) {
      if (error instanceof BillingPinMissingError) return null;
      throw error;
    }
  });
  return matches.find((id): id is string => id != null) ?? null;
}

async function workspaceIdForWebhook(event: WebhookEvent): Promise<string | null> {
  if (event.type === "checkout.session.completed") {
    return workspaceIdForPendingCheckout(event.objectId);
  }
  if (PAYMENT_WEBHOOKS.has(event.type)) {
    return event.providerSubscriptionId
      ? workspaceIdForSubscription(event.providerSubscriptionId)
      : null;
  }
  return workspaceIdForSubscription(event.objectId);
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
    recordVerifiedSignature();
  } catch (error) {
    if (error instanceof BillingProviderClosedError) throw error;
    // Credentials absent is a different fact from credentials wrong, and only
    // the second one says anything about which account signed (#229).
    recordRejectedSignature();
    warnIfSecretLooksWrong();
    if (error instanceof BillingWebhookSignatureError) throw error;
    throw new BillingWebhookSignatureError();
  }
  const known =
    PROJECTABLE_WEBHOOK_TYPES.has(event.type) ||
    PAYMENT_WEBHOOKS.has(event.type) ||
    DISPUTE_WEBHOOKS.has(event.type);
  if (!known) {
    throw new UnknownBillingWebhookError();
  }
  if (DISPUTE_WEBHOOKS.has(event.type)) {
    return ingestDisputeWebhook(event, input.provider);
  }

  const workspaceId = await workspaceIdForWebhook(event);

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

/**
 * A dispute event carries no customer, so the dispute is re-fetched before the
 * transaction and its customer names the Workspace. The inbox row and the
 * dispute row commit together; an unmatched dispute is inbox-only, as an
 * unmatched Subscription event is.
 */
async function ingestDisputeWebhook(
  event: WebhookEvent,
  provider: BillingProvider
): Promise<IngestBillingWebhookResult> {
  const dispute = await provider.fetchDispute(event.objectId);
  const workspaceId = dispute.providerCustomerId
    ? await workspaceIdForCustomer(dispute.providerCustomerId)
    : null;

  const record = () =>
    db.transaction(async (tx) => {
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
      if (workspaceId) {
        const values = {
          providerChargeId: dispute.providerChargeId,
          amountMinor: dispute.amountMinor,
          currency: dispute.currency,
          reason: dispute.reason,
          status: dispute.status,
          openedAt: dispute.openedAt,
        };
        await tx
          .insert(paymentDisputes)
          .values(stampWorkspace({ providerDisputeId: dispute.providerDisputeId, ...values }))
          .onConflictDoUpdate({
            target: paymentDisputes.providerDisputeId,
            set: { ...values, updatedAt: new Date() },
          });
      }
      await markInboxProcessed(event.providerEventId, tx);
      return { accepted: true as const, duplicate: false, enqueued: false };
    });
  return workspaceId ? runWithWorkspaceContext({ workspaceId }, record) : record();
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

  if (PAYMENT_WEBHOOKS.has(inbox.type)) {
    // Stripe retries a webhook for days, so the invoice may be paid by now.
    const invoice = await provider.fetchInvoice(objectId);
    await db.transaction(async (tx) => {
      await tx
        .insert(billingPayments)
        .values(
          stampWorkspace({
            providerEventId,
            providerInvoiceId: objectId,
            outcome: inbox.type === PAYMENT_PAID_WEBHOOK ? "paid" : "failed",
            amountMinor: invoice.amountMinor ?? null,
            currency: invoice.currency ?? null,
            occurredAt: new Date(),
          })
        )
        .onConflictDoNothing();
      if (inbox.type === PAYMENT_FAILED_WEBHOOK && !invoice.paid) {
        await recordPaymentFailedNotice(tx, providerEventId, invoice.nextPaymentAttemptAt);
      }
      await markInboxProcessed(providerEventId, tx);
    });
    return;
  }

  if (inbox.type === "checkout.session.completed") {
    const session = await provider.fetchCheckoutSession(objectId);
    const subscription = await provider.fetchSubscription(session.providerSubscriptionId);
    await applyProjectionAndSyncSeats(subscription, provider);
    await markInboxProcessed(providerEventId);
    return;
  }

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
  await applyProjectionAndSyncSeats(subscription, provider);
  await markInboxProcessed(providerEventId);
}

async function applyProjectionAndSyncSeats(
  subscription: Parameters<typeof applyProviderSubscription>[0],
  provider: BillingProvider
): Promise<void> {
  const result = await applyProviderSubscription(subscription, { kind: "system" });
  if (result.syncSeatQuantity == null || !result.projection.stripeSubscriptionId) return;
  await provider.updateSeatQuantity({
    providerSubscriptionId: result.projection.stripeSubscriptionId,
    seatQuantity: result.syncSeatQuantity,
    proration: "none",
  });
}

async function markInboxProcessed(
  providerEventId: string,
  writer: Pick<typeof db, "update"> = db
): Promise<void> {
  await writer
    .update(billingWebhookInbox)
    .set({ processedAt: new Date() })
    .where(eq(billingWebhookInbox.providerEventId, providerEventId));
}

export async function handleBillingDriftJob(
  job: Job,
  provider: BillingProvider = billingProviderFromAppConfig(config.billing)
): Promise<void> {
  const [row] = await db.select().from(workspaceBilling).where(inWorkspace(workspaceBilling)).limit(1);
  if (!row?.stripeSubscriptionId) return;

  if (
    row.pendingSeatQuantity != null &&
    row.periodEndsAt &&
    Date.now() >= row.periodEndsAt.getTime()
  ) {
    await applyPendingSeatDecrease({ kind: "system" }, provider);
  }

  const pin = await getBillingProjection();
  if (!pin.stripeSubscriptionId) return;

  const subscription = await provider.fetchSubscription(pin.stripeSubscriptionId);
  // Only a webhook writes the price, so a Subscription that existed before the
  // columns did has none. Record it here: a price fact, not an Entitlement, so
  // no authorization version bump, Audit Event or Outbox Event.
  const unitAmountMinor = subscription.unitAmountMinor ?? null;
  const currency = subscription.currency ?? null;
  if ((row.unitAmountMinor ?? null) !== unitAmountMinor || (row.currency ?? null) !== currency) {
    await db
      .update(workspaceBilling)
      .set({ unitAmountMinor, currency })
      .where(inWorkspace(workspaceBilling));
  }
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

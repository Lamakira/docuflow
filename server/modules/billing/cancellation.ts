/**
 * Ending a paid Subscription at its period end, and keeping it again (F102,
 * ADR-0010). The Billing page and the back office share this one path.
 *
 * Stripe is asked first, outside the transaction, so a refused call leaves the
 * pin and the Audit Log untouched. The flag and its Audit Event follow under the
 * pin's lock. Should that write fail once Stripe has agreed, Stripe's own event
 * projects the flag, so the two still end the same.
 */

import { auditEvents, workspaceBilling } from "@shared/schema";
import { db } from "../../db";
import { inWorkspace, requireWorkspaceContext, stampWorkspace } from "../../workspaceContext";
import type { BillingProvider } from "./billingProvider";
import {
  BillingPinMissingError,
  billingProjectionOf,
  hasPaidSubscription,
  type AuditActor,
  type BillingProjection,
} from "./entitlements";
import { InvalidBillingTransitionError } from "./stateMachine";

/**
 * The customer asks for an outcome: one already in place is a success, once
 * Stripe has been told. Staff act on what they see, so a repeat is refused and
 * they read the Workspace again.
 */
type Caller = "customer" | "operator";

function refusal(caller: Caller, cancel: boolean, reason: "no_subscription" | "repeat"): InvalidBillingTransitionError {
  if (caller === "customer") {
    return new InvalidBillingTransitionError(
      cancel ? "There is no Subscription to cancel" : "There is no Subscription to keep"
    );
  }
  if (reason === "no_subscription") {
    return new InvalidBillingTransitionError("Only a paid Subscription can be set to end at its period end");
  }
  return new InvalidBillingTransitionError(
    cancel
      ? "The Subscription already ends at its period end"
      : "The Subscription is not set to end at its period end"
  );
}

export async function setCancelAtPeriodEnd(
  actor: AuditActor,
  input: { cancel: boolean },
  provider: BillingProvider,
  caller: Caller
): Promise<BillingProjection> {
  const [current] = await db
    .select()
    .from(workspaceBilling)
    .where(inWorkspace(workspaceBilling))
    .limit(1);
  if (!current) throw new BillingPinMissingError();
  if (!hasPaidSubscription(current)) {
    // Nothing is cancelling, so there is nothing to keep.
    if (caller === "customer" && !input.cancel && !current.cancelAtPeriodEnd) return billingProjectionOf(current);
    throw refusal(caller, input.cancel, "no_subscription");
  }
  // The customer's repeat still asks Stripe, whose update is idempotent: a flag
  // the old code set without telling Stripe is sent by clicking again.
  if (caller === "operator" && current.cancelAtPeriodEnd === input.cancel) {
    throw refusal(caller, input.cancel, "repeat");
  }
  const providerSubscriptionId = current.stripeSubscriptionId!;
  await provider.setCancelAtPeriodEnd({ providerSubscriptionId, cancel: input.cancel });

  const { workspaceId } = requireWorkspaceContext();
  return db.transaction(async (tx) => {
    const [pin] = await tx
      .select()
      .from(workspaceBilling)
      .where(inWorkspace(workspaceBilling))
      .for("update")
      .limit(1);
    if (!pin) throw new BillingPinMissingError();
    if (!hasPaidSubscription(pin) || pin.stripeSubscriptionId !== providerSubscriptionId) {
      throw refusal(caller, input.cancel, "no_subscription");
    }
    // The flag already says what was asked (a repeat, or Stripe's event for this
    // very change landed first): nothing to write and no Audit Event to add.
    if (pin.cancelAtPeriodEnd === input.cancel) return billingProjectionOf(pin);

    const [updated] = await tx
      .update(workspaceBilling)
      .set({
        cancelAtPeriodEnd: input.cancel,
        authorizationVersion: pin.authorizationVersion + 1,
        updatedAt: new Date(),
      })
      .where(inWorkspace(workspaceBilling))
      .returning();
    await tx.insert(auditEvents).values(
      stampWorkspace({
        actorKind: actor.kind,
        actorId: actor.id ?? null,
        action: input.cancel ? "billing.cancel_at_period_end" : "billing.cancel_at_period_end_undone",
        resourceType: "workspace_billing",
        resourceId: workspaceId,
        payload: { periodEndsAt: pin.periodEndsAt ? pin.periodEndsAt.toISOString() : null },
      })
    );
    return billingProjectionOf(updated);
  });
}

/** Only a live Subscription (Active or Past due) can be cancelled; a Trial or an Offered Plan has none. */
export async function cancelAtPeriodEnd(actor: AuditActor, provider: BillingProvider): Promise<BillingProjection> {
  return setCancelAtPeriodEnd(actor, { cancel: true }, provider, "customer");
}

/** The undo, until the period ends. */
export async function keepSubscription(actor: AuditActor, provider: BillingProvider): Promise<BillingProjection> {
  return setCancelAtPeriodEnd(actor, { cancel: false }, provider, "customer");
}

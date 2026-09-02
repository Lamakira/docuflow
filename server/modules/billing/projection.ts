/**
 * Provider-neutral billing projection (#143, ADR-0010). Re-fetched Subscription
 * state becomes DocuFlow billing state, not a raw Stripe enum. Entitlement
 * recomputes bump the authorization version and emit Outbox Events. Billing
 * changes are Audit Events; they are not Outbox Events.
 */

import { auditEvents, outboxEvents, workspaceBilling } from "@shared/schema";
import { db } from "../../db";
import { inWorkspace, requireWorkspaceContext, stampWorkspace } from "../../workspaceContext";
import type { CollectionState, ProviderSubscription } from "./billingProvider";
import {
  BillingPinMissingError,
  billingProjectionOf,
  type AuditActor,
  type BillingProjection,
} from "./entitlements";
import type { BillingState, PlanKey } from "./planRegistry";

export const BILLING_ENTITLEMENTS_CHANGED = "billing.entitlements_changed";

type ProjectedPin = {
  planKey: PlanKey;
  billingState: BillingState;
  purchasedSeatCapacity: number;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  periodEndsAt: Date;
  cancelAtPeriodEnd: boolean;
  trialEndsAt: Date | null;
};

export function billingStateFromCollection(collection: CollectionState): BillingState {
  if (collection === "Canceled") return "ReadOnly";
  if (collection === "PastDue") return "PastDue";
  return "Active";
}

function sameInstant(left: Date | null, right: Date | null): boolean {
  if (left == null && right == null) return true;
  if (left == null || right == null) return false;
  return left.getTime() === right.getTime();
}

export function projectedPinFromSubscription(
  subscription: ProviderSubscription,
  trialEndsAt: Date | null
): ProjectedPin {
  const billingState = billingStateFromCollection(subscription.collectionState);
  return {
    planKey: subscription.planKey,
    billingState,
    purchasedSeatCapacity: subscription.seatQuantity,
    stripeCustomerId: subscription.providerCustomerId,
    stripeSubscriptionId: subscription.providerSubscriptionId,
    periodEndsAt: subscription.currentPeriodEnd,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    trialEndsAt: billingState === "Active" ? null : trialEndsAt,
  };
}

export function pinAgreesWithSubscription(
  pin: {
    planKey: string;
    billingState: string;
    purchasedSeatCapacity: number;
    stripeCustomerId: string | null;
    stripeSubscriptionId: string | null;
    cancelAtPeriodEnd: boolean;
    periodEndsAt: Date | null;
    trialEndsAt: Date | null;
  },
  subscription: ProviderSubscription
): boolean {
  const next = projectedPinFromSubscription(subscription, pin.trialEndsAt);
  return (
    pin.planKey === next.planKey &&
    pin.billingState === next.billingState &&
    pin.purchasedSeatCapacity === next.purchasedSeatCapacity &&
    (pin.stripeCustomerId ?? null) === next.stripeCustomerId &&
    (pin.stripeSubscriptionId ?? null) === next.stripeSubscriptionId &&
    pin.cancelAtPeriodEnd === next.cancelAtPeriodEnd &&
    sameInstant(pin.periodEndsAt ?? null, next.periodEndsAt) &&
    sameInstant(pin.trialEndsAt ?? null, next.trialEndsAt)
  );
}

export async function applyProviderSubscription(
  subscription: ProviderSubscription,
  actor: AuditActor
): Promise<{ projection: BillingProjection; mutated: boolean }> {
  const { workspaceId } = requireWorkspaceContext();

  return db.transaction(async (tx) => {
    const [pin] = await tx
      .select()
      .from(workspaceBilling)
      .where(inWorkspace(workspaceBilling))
      .for("update")
      .limit(1);
    if (!pin) throw new BillingPinMissingError();

    const next = projectedPinFromSubscription(subscription, pin.trialEndsAt);
    if (pinAgreesWithSubscription(pin, subscription)) {
      return { projection: billingProjectionOf(pin), mutated: false };
    }

    const entitlementsChanged =
      pin.planKey !== next.planKey ||
      pin.billingState !== next.billingState ||
      pin.purchasedSeatCapacity !== next.purchasedSeatCapacity;
    const authorizationVersion = entitlementsChanged
      ? pin.authorizationVersion + 1
      : pin.authorizationVersion;

    const [updated] = await tx
      .update(workspaceBilling)
      .set({
        ...next,
        authorizationVersion,
        updatedAt: new Date(),
      })
      .where(inWorkspace(workspaceBilling))
      .returning();

    if (pin.billingState !== next.billingState) {
      await tx.insert(auditEvents).values(
        stampWorkspace({
          actorKind: actor.kind,
          actorId: actor.id ?? null,
          action: "billing.state_transition",
          resourceType: "workspace_billing",
          resourceId: workspaceId,
          payload: { from: pin.billingState, to: next.billingState, reason: "provider_projection" },
        })
      );
    }
    if (pin.planKey !== next.planKey) {
      await tx.insert(auditEvents).values(
        stampWorkspace({
          actorKind: actor.kind,
          actorId: actor.id ?? null,
          action: "billing.plan_change",
          resourceType: "workspace_billing",
          resourceId: workspaceId,
          payload: { from: pin.planKey, to: next.planKey },
        })
      );
    }
    if (pin.purchasedSeatCapacity !== next.purchasedSeatCapacity) {
      await tx.insert(auditEvents).values(
        stampWorkspace({
          actorKind: actor.kind,
          actorId: actor.id ?? null,
          action: "billing.seats_change",
          resourceType: "workspace_billing",
          resourceId: workspaceId,
          payload: { from: pin.purchasedSeatCapacity, to: next.purchasedSeatCapacity },
        })
      );
    }
    if (!entitlementsChanged) {
      await tx.insert(auditEvents).values(
        stampWorkspace({
          actorKind: actor.kind,
          actorId: actor.id ?? null,
          action: "billing.projection_applied",
          resourceType: "workspace_billing",
          resourceId: workspaceId,
          payload: { reason: "provider_projection" },
        })
      );
    }

    if (entitlementsChanged) {
      await tx.insert(outboxEvents).values(
        stampWorkspace({
          type: BILLING_ENTITLEMENTS_CHANGED,
          version: 1,
          actorKind: actor.kind,
          actorId: actor.id ?? null,
          aggregateType: "workspace_billing",
          aggregateId: workspaceId,
          payload: { authorizationVersion },
        })
      );
    }

    return { projection: billingProjectionOf(updated), mutated: true };
  });
}

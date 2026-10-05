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
import { recordReadOnlyNotice } from "./lifecycleEmails";
import {
  BillingPinMissingError,
  billingProjectionOf,
  type AuditActor,
  type BillingProjection,
} from "./entitlements";
import {
  isPlanKey,
  placePlan,
  PLAN_REGISTRY,
  type BillingInterval,
  type BillingState,
  type PlanKey,
} from "./planRegistry";
import { countConsumedSeats, resolveProjectedSeatCapacity } from "./seats";

export const BILLING_ENTITLEMENTS_CHANGED = "billing.entitlements_changed";

type ProjectedPin = {
  planKey: PlanKey;
  registryVersion: number;
  billingInterval: BillingInterval;
  billingState: BillingState;
  purchasedSeatCapacity: number;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  periodEndsAt: Date;
  cancelAtPeriodEnd: boolean;
  trialEndsAt: Date | null;
  /** Price as Stripe last reported it. Shown in the back office; never an Entitlement. */
  unitAmountMinor: number | null;
  currency: string | null;
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

type CurrentPlan = { planKey: string; registryVersion: number; trialEndsAt: Date | null };

/**
 * The Plan a Subscription puts the Workspace on (ADR-0027). A sales-led Plan
 * (Enterprise) is assigned in DocuFlow and survives whatever Price Stripe bills.
 */
function projectedPlan(
  subscription: ProviderSubscription,
  current: CurrentPlan
): { planKey: PlanKey; registryVersion: number } {
  if (
    isPlanKey(current.planKey) &&
    PLAN_REGISTRY[current.registryVersion]?.[current.planKey]?.salesLed
  ) {
    return { planKey: current.planKey, registryVersion: current.registryVersion };
  }
  return placePlan(subscription.planKey, current.registryVersion);
}

export function projectedPinFromSubscription(
  subscription: ProviderSubscription,
  current: CurrentPlan
): ProjectedPin {
  const billingState = billingStateFromCollection(subscription.collectionState);
  const trialEndsAt = current.trialEndsAt;
  return {
    ...projectedPlan(subscription, current),
    billingInterval: subscription.interval,
    billingState,
    purchasedSeatCapacity: subscription.seatQuantity,
    stripeCustomerId: subscription.providerCustomerId,
    stripeSubscriptionId: subscription.providerSubscriptionId,
    periodEndsAt: subscription.currentPeriodEnd,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    trialEndsAt: billingState === "Active" ? null : trialEndsAt,
    unitAmountMinor: subscription.unitAmountMinor ?? null,
    currency: subscription.currency ?? null,
  };
}

export function pinAgreesWithSubscription(
  pin: {
    planKey: string;
    registryVersion: number;
    billingInterval: string | null;
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
  const next = projectedPinFromSubscription(subscription, pin);
  return (
    pin.planKey === next.planKey &&
    pin.registryVersion === next.registryVersion &&
    (pin.billingInterval ?? null) === next.billingInterval &&
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
): Promise<{ projection: BillingProjection; mutated: boolean; syncSeatQuantity: number | null }> {
  const { workspaceId } = requireWorkspaceContext();

  return db.transaction(async (tx) => {
    const [pin] = await tx
      .select()
      .from(workspaceBilling)
      .where(inWorkspace(workspaceBilling))
      .for("update")
      .limit(1);
    if (!pin) throw new BillingPinMissingError();

    const next = projectedPinFromSubscription(subscription, pin);
    const seats = resolveProjectedSeatCapacity(pin, subscription, await countConsumedSeats(tx));
    next.purchasedSeatCapacity = seats.purchasedSeatCapacity;

    const planChanged = pin.planKey !== next.planKey || pin.registryVersion !== next.registryVersion;
    const pinUnchanged =
      !planChanged &&
      (pin.billingInterval ?? null) === next.billingInterval &&
      pin.billingState === next.billingState &&
      pin.purchasedSeatCapacity === next.purchasedSeatCapacity &&
      (pin.stripeCustomerId ?? null) === next.stripeCustomerId &&
      (pin.stripeSubscriptionId ?? null) === next.stripeSubscriptionId &&
      pin.cancelAtPeriodEnd === next.cancelAtPeriodEnd &&
      sameInstant(pin.periodEndsAt ?? null, next.periodEndsAt) &&
      sameInstant(pin.trialEndsAt ?? null, next.trialEndsAt) &&
      (pin.unitAmountMinor ?? null) === next.unitAmountMinor &&
      (pin.currency ?? null) === next.currency &&
      (pin.pendingSeatQuantity ?? null) === (seats.pendingSeatQuantity ?? null);

    if (pinUnchanged) {
      if (pin.pendingCheckoutSessionId) {
        await tx
          .update(workspaceBilling)
          .set({ pendingCheckoutSessionId: null, updatedAt: new Date() })
          .where(inWorkspace(workspaceBilling));
      }
      return {
        projection: billingProjectionOf(pin),
        mutated: false,
        syncSeatQuantity: null,
      };
    }

    const entitlementsChanged =
      planChanged ||
      pin.billingState !== next.billingState ||
      pin.purchasedSeatCapacity !== next.purchasedSeatCapacity;
    const authorizationVersion = entitlementsChanged
      ? pin.authorizationVersion + 1
      : pin.authorizationVersion;

    const [updated] = await tx
      .update(workspaceBilling)
      .set({
        ...next,
        pendingSeatQuantity: seats.pendingSeatQuantity,
        pendingCheckoutSessionId: null,
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
      if (next.billingState === "ReadOnly") {
        // Stripe ending a past-due Subscription is dunning running out.
        const reason = pin.billingState === "PastDue" ? "dunning_exhausted" : "provider_projection";
        await recordReadOnlyNotice(tx, reason, authorizationVersion);
      }
    }
    if (planChanged) {
      await tx.insert(auditEvents).values(
        stampWorkspace({
          actorKind: actor.kind,
          actorId: actor.id ?? null,
          action: "billing.plan_change",
          resourceType: "workspace_billing",
          resourceId: workspaceId,
          payload: {
            from: pin.planKey,
            to: next.planKey,
            fromRegistryVersion: pin.registryVersion,
            toRegistryVersion: next.registryVersion,
          },
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

    return {
      projection: billingProjectionOf(updated),
      mutated: true,
      syncSeatQuantity: seats.tellProvider ? seats.purchasedSeatCapacity : null,
    };
  });
}

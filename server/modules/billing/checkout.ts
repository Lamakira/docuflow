/**
 * Checkout, payment-method update, and Plan/seat commands (#144, ADR-0010).
 * Plan and seats are decided here. Money movement is a hosted BillingProvider
 * URL. The return path does not mark Active until the projection Job runs.
 */

import { SEEDED_WORKSPACE_ID, auditEvents, outboxEvents, workspaceBilling } from "@shared/schema";
import { db } from "../../db";
import { inWorkspace, requireWorkspaceContext, stampWorkspace } from "../../workspaceContext";
import type { BillingProvider, HostedBillingSession } from "./billingProvider";
import {
  billingProjectionOf,
  getBillingProjection,
  type AuditActor,
  type BillingProjection,
} from "./entitlements";
import {
  PLAN_REGISTRY,
  PLAN_REGISTRY_VERSION,
  PRICED_PLAN_KEYS,
  isPlanKey,
  type BillingInterval,
  type PlanKey,
} from "./planRegistry";
import { BILLING_ENTITLEMENTS_CHANGED } from "./projection";
import { countConsumedSeats, SeatCapacityFloorError } from "./seats";

export class SeededWorkspaceCheckoutError extends Error {
  readonly statusCode = 400;
  constructor() {
    super("The seeded Workspace cannot start Checkout");
    this.name = "SeededWorkspaceCheckoutError";
  }
}

export class InvalidCheckoutError extends Error {
  readonly statusCode = 400;
  constructor(detail: string) {
    super(detail);
    this.name = "InvalidCheckoutError";
  }
}

export class PaymentMethodUpdateUnavailableError extends Error {
  readonly statusCode = 400;
  constructor() {
    super("Payment-method update requires a Stripe customer");
    this.name = "PaymentMethodUpdateUnavailableError";
  }
}

export type SubscriptionStatus = BillingProjection & { consumedSeatCount: number };

export async function getSubscriptionStatus(): Promise<SubscriptionStatus> {
  const pin = await getBillingProjection();
  const consumedSeatCount = await countConsumedSeats();
  return { ...pin, consumedSeatCount };
}

export type StartCheckoutInput = {
  planKey: PlanKey;
  interval: BillingInterval;
  seatQuantity: number;
  successUrl: string;
  cancelUrl: string;
};

function assertPricedPlan(planKey: PlanKey): void {
  if (!(PRICED_PLAN_KEYS as readonly PlanKey[]).includes(planKey)) {
    throw new InvalidCheckoutError(
      `Plan ${planKey} is not sold through Checkout. Choose Starter, Growth or Business.`
    );
  }
}

function hasLiveSubscription(pin: BillingProjection): boolean {
  return (
    pin.stripeSubscriptionId != null &&
    (pin.billingState === "Active" || pin.billingState === "PastDue")
  );
}

export async function startCheckout(
  input: StartCheckoutInput,
  _actor: AuditActor,
  provider: BillingProvider
): Promise<HostedBillingSession> {
  const pin = await getBillingProjection();
  const { workspaceId } = requireWorkspaceContext();
  if (pin.planKey === "legacy" || workspaceId === SEEDED_WORKSPACE_ID) {
    throw new SeededWorkspaceCheckoutError();
  }
  assertPricedPlan(input.planKey);
  if (hasLiveSubscription(pin)) {
    throw new InvalidCheckoutError("This Workspace already has a Subscription. Change its Plan instead.");
  }
  const consumed = await countConsumedSeats();
  const minimum = Math.max(consumed, 1);
  if (input.seatQuantity < minimum) {
    throw new SeatCapacityFloorError(consumed);
  }

  const session = await provider.createCheckout({
    workspaceId,
    planKey: input.planKey,
    interval: input.interval,
    seatQuantity: input.seatQuantity,
    successUrl: input.successUrl,
    cancelUrl: input.cancelUrl,
    providerCustomerId: pin.stripeCustomerId,
  });
  await db
    .update(workspaceBilling)
    .set({ pendingCheckoutSessionId: session.providerSessionId, updatedAt: new Date() })
    .where(inWorkspace(workspaceBilling));
  return session;
}

export type ChangePlanInput = {
  planKey: PlanKey;
  interval: BillingInterval;
};

/**
 * Moves a paying Workspace to another priced Plan (ADR-0027). Stripe swaps
 * the Price first, prorated; DocuFlow then applies the Plan at once rather
 * than waiting for the webhook, which will agree with it.
 */
export async function changePlan(
  input: ChangePlanInput,
  actor: AuditActor,
  provider: BillingProvider
): Promise<BillingProjection> {
  assertPricedPlan(input.planKey);
  const pin = await getBillingProjection();
  if (!hasLiveSubscription(pin) || !pin.stripeSubscriptionId) {
    throw new InvalidCheckoutError("Changing Plan needs an active Subscription. Start Checkout first.");
  }
  if (isPlanKey(pin.planKey) && PLAN_REGISTRY[pin.registryVersion]?.[pin.planKey]?.salesLed) {
    throw new InvalidCheckoutError("This Workspace's Plan is managed by DocuFlow sales.");
  }
  if (
    pin.planKey === input.planKey &&
    pin.registryVersion === PLAN_REGISTRY_VERSION &&
    pin.billingInterval === input.interval
  ) {
    throw new InvalidCheckoutError("The Workspace is already on this Plan.");
  }

  await provider.changeSubscriptionPlan({
    providerSubscriptionId: pin.stripeSubscriptionId,
    planKey: input.planKey,
    interval: input.interval,
  });

  const { workspaceId } = requireWorkspaceContext();
  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(workspaceBilling)
      .where(inWorkspace(workspaceBilling))
      .for("update")
      .limit(1);
    const authorizationVersion = locked.authorizationVersion + 1;
    const [updated] = await tx
      .update(workspaceBilling)
      .set({
        planKey: input.planKey,
        registryVersion: PLAN_REGISTRY_VERSION,
        billingInterval: input.interval,
        authorizationVersion,
        updatedAt: new Date(),
      })
      .where(inWorkspace(workspaceBilling))
      .returning();
    await tx.insert(auditEvents).values(
      stampWorkspace({
        actorKind: actor.kind,
        actorId: actor.id ?? null,
        action: "billing.plan_change",
        resourceType: "workspace_billing",
        resourceId: workspaceId,
        payload: {
          from: locked.planKey,
          to: input.planKey,
          fromRegistryVersion: locked.registryVersion,
          toRegistryVersion: PLAN_REGISTRY_VERSION,
          interval: input.interval,
          reason: "plan_change",
        },
      })
    );
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
    return billingProjectionOf(updated);
  });
}

export type StartPaymentMethodUpdateInput = {
  returnUrl: string;
};

export async function startPaymentMethodUpdate(
  input: StartPaymentMethodUpdateInput,
  _actor: AuditActor,
  provider: BillingProvider
): Promise<HostedBillingSession> {
  const pin = await getBillingProjection();
  if (!pin.stripeCustomerId) {
    throw new PaymentMethodUpdateUnavailableError();
  }
  return provider.createPaymentMethodUpdate({
    providerCustomerId: pin.stripeCustomerId,
    returnUrl: input.returnUrl,
  });
}

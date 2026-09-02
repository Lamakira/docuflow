/**
 * Checkout, payment-method update, and Plan/seat commands (#144, ADR-0010).
 * Plan and seats are decided here. Money movement is a hosted BillingProvider
 * URL. The return path does not mark Active until the projection Job runs.
 */

import { memberships, SEEDED_WORKSPACE_ID, workspaceBilling, workspaceRoles } from "@shared/schema";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { currentWorkspaceContext, inWorkspace, requireWorkspaceContext } from "../../workspaceContext";
import type { BillingProvider, HostedBillingSession } from "./billingProvider";
import {
  getBillingProjection,
  type AuditActor,
  type BillingProjection,
} from "./entitlements";
import type { PlanKey } from "./planRegistry";
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

/** Owner and Administrator may manage billing. Member may not. */
export async function canManageBilling(): Promise<boolean> {
  const ctx = currentWorkspaceContext();
  if (!ctx?.membershipId) return false;
  const [row] = await db
    .select({ slug: workspaceRoles.slug })
    .from(memberships)
    .innerJoin(workspaceRoles, eq(memberships.workspaceRoleId, workspaceRoles.id))
    .where(eq(memberships.id, ctx.membershipId));
  return row?.slug === "owner" || row?.slug === "administrator";
}

export async function getSubscriptionStatus(): Promise<SubscriptionStatus> {
  const pin = await getBillingProjection();
  const consumedSeatCount = await countConsumedSeats();
  return { ...pin, consumedSeatCount };
}

export type StartCheckoutInput = {
  planKey: PlanKey;
  seatQuantity: number;
  successUrl: string;
  cancelUrl: string;
};

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
  if (input.planKey !== "pro") {
    throw new InvalidCheckoutError("Checkout is only available for Plan pro");
  }
  const consumed = await countConsumedSeats();
  const minimum = Math.max(consumed, 1);
  if (input.seatQuantity < minimum) {
    throw new SeatCapacityFloorError(consumed);
  }

  const session = await provider.createCheckout({
    workspaceId,
    planKey: input.planKey,
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

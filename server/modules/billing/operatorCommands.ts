/**
 * Back-office billing commands (#314, ADR-0010, ADR-0015). Platform Staff
 * extend a Trial, offer a Plan to a Workspace that has no paid Subscription, and
 * flag or unflag a paid Subscription to end at its period end.
 *
 * Each command runs in the target Workspace's context, bumps the authorization
 * version, and writes exactly one Audit Event naming the staff member. They do
 * not go through the state machine's `applyState`, which writes a
 * `billing.state_transition` of its own: an operator action is one fact.
 *
 * An Offered Plan is Trialing on a Plan other than `trial`. It ends through the
 * same Trial lifecycle (reminders, then ReadOnly), and it never touches Stripe.
 */

import { auditEvents, outboxEvents, workspaceBilling } from "@shared/schema";
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
import { PLAN_REGISTRY, PLAN_REGISTRY_VERSION, isPlanKey, purchasesSeats } from "./planRegistry";
import { BILLING_ENTITLEMENTS_CHANGED } from "./projection";
import { countConsumedSeats } from "./seats";
import { InvalidBillingTransitionError, addUtcDays } from "./stateMachine";

/** The Workspace is on, or was sold, a paid Subscription: an offer would overwrite it. */
export class PaidSubscriptionError extends Error {
  readonly statusCode = 409;
  constructor() {
    super("Only a Workspace without a paid Subscription can be offered a Plan");
    this.name = "PaidSubscriptionError";
  }
}

export class OfferedPlanUnknownError extends Error {
  readonly statusCode = 400;
  constructor() {
    super("Choose a Plan from the current registry other than the Trial");
    this.name = "OfferedPlanUnknownError";
  }
}

type PinRow = typeof workspaceBilling.$inferSelect;
type Writer = Pick<typeof db, "insert" | "update" | "select">;

async function lockPin(tx: Writer): Promise<PinRow> {
  const [pin] = await tx
    .select()
    .from(workspaceBilling)
    .where(inWorkspace(workspaceBilling))
    .for("update")
    .limit(1);
  if (!pin) throw new BillingPinMissingError();
  return pin;
}

async function recordOperatorAudit(
  tx: Writer,
  actor: AuditActor,
  action: string,
  payload: Record<string, unknown>
): Promise<void> {
  const { workspaceId } = requireWorkspaceContext();
  await tx.insert(auditEvents).values(
    stampWorkspace({
      actorKind: actor.kind,
      actorId: actor.id ?? null,
      action,
      resourceType: "workspace_billing",
      resourceId: workspaceId,
      payload,
    })
  );
}

export async function extendTrial(
  actor: AuditActor,
  input: { days: number },
  options: { now?: Date } = {}
): Promise<BillingProjection> {
  const now = options.now ?? new Date();
  return db.transaction(async (tx) => {
    const pin = await lockPin(tx);
    if (pin.billingState !== "Trialing") {
      throw new InvalidBillingTransitionError("Only a Workspace that is Trialing can have its Trial extended");
    }
    const from = pin.trialEndsAt ?? now;
    const to = addUtcDays(from, input.days);
    const [updated] = await tx
      .update(workspaceBilling)
      .set({
        trialEndsAt: to,
        authorizationVersion: pin.authorizationVersion + 1,
        updatedAt: new Date(),
      })
      .where(inWorkspace(workspaceBilling))
      .returning();
    await recordOperatorAudit(tx, actor, "billing.trial_extended", {
      from: pin.trialEndsAt ? pin.trialEndsAt.toISOString() : null,
      to: to.toISOString(),
      days: input.days,
    });
    return billingProjectionOf(updated);
  });
}

export async function offerPlan(
  actor: AuditActor,
  input: { planKey: string; days: number; seats?: number },
  options: { now?: Date } = {}
): Promise<BillingProjection> {
  const now = options.now ?? new Date();
  const plan = isPlanKey(input.planKey)
    ? PLAN_REGISTRY[PLAN_REGISTRY_VERSION]?.[input.planKey]
    : undefined;
  if (!isPlanKey(input.planKey) || input.planKey === "trial" || !plan) {
    throw new OfferedPlanUnknownError();
  }
  const planKey = input.planKey;

  return db.transaction(async (tx) => {
    const pin = await lockPin(tx);
    if (hasPaidSubscription(pin) || (pin.billingState !== "Trialing" && pin.billingState !== "ReadOnly")) {
      throw new PaidSubscriptionError();
    }
    const endsAt = addUtcDays(now, input.days);
    const seats = purchasesSeats(planKey, PLAN_REGISTRY_VERSION)
      ? Math.max(input.seats ?? 0, await countConsumedSeats(tx), plan.minimumSeatCapacity ?? 1)
      : pin.purchasedSeatCapacity;
    const [updated] = await tx
      .update(workspaceBilling)
      .set({
        planKey,
        registryVersion: PLAN_REGISTRY_VERSION,
        billingState: "Trialing",
        trialEndsAt: endsAt,
        purchasedSeatCapacity: seats,
        cancelAtPeriodEnd: false,
        periodEndsAt: null,
        // An ended Subscription must not be matched by a stray webhook. The
        // Stripe customer stays, so a later Checkout reuses it.
        stripeSubscriptionId: null,
        billingInterval: null,
        unitAmountMinor: null,
        currency: null,
        pendingSeatQuantity: null,
        authorizationVersion: pin.authorizationVersion + 1,
        updatedAt: new Date(),
      })
      .where(inWorkspace(workspaceBilling))
      .returning();
    await recordOperatorAudit(tx, actor, "billing.plan_offered", {
      from: pin.billingState,
      to: "Trialing",
      planKey,
      days: input.days,
      endsAt: endsAt.toISOString(),
      seats,
    });
    // The Plan and seats changed, so Entitlements did: tell the other modules.
    await tx.insert(outboxEvents).values(
      stampWorkspace({
        type: BILLING_ENTITLEMENTS_CHANGED,
        version: 1,
        actorKind: actor.kind,
        actorId: actor.id ?? null,
        aggregateType: "workspace_billing",
        aggregateId: requireWorkspaceContext().workspaceId,
        payload: { authorizationVersion: updated.authorizationVersion },
      })
    );
    return billingProjectionOf(updated);
  });
}

/**
 * Stripe is asked first, outside the transaction, so a refused call leaves the
 * pin and the Audit Log untouched. The webhook projection later agrees with it.
 */
export async function setOperatorCancelAtPeriodEnd(
  actor: AuditActor,
  input: { cancel: boolean },
  provider: BillingProvider
): Promise<BillingProjection> {
  const [current] = await db
    .select()
    .from(workspaceBilling)
    .where(inWorkspace(workspaceBilling))
    .limit(1);
  if (!current) throw new BillingPinMissingError();
  assertCancellable(current, input.cancel);
  await provider.setCancelAtPeriodEnd({
    providerSubscriptionId: current.stripeSubscriptionId!,
    cancel: input.cancel,
  });

  return db.transaction(async (tx) => {
    const pin = await lockPin(tx);
    assertCancellable(pin, input.cancel);
    const [updated] = await tx
      .update(workspaceBilling)
      .set({
        cancelAtPeriodEnd: input.cancel,
        authorizationVersion: pin.authorizationVersion + 1,
        updatedAt: new Date(),
      })
      .where(inWorkspace(workspaceBilling))
      .returning();
    await recordOperatorAudit(
      tx,
      actor,
      input.cancel ? "billing.cancel_at_period_end" : "billing.cancel_at_period_end_undone",
      { periodEndsAt: pin.periodEndsAt ? pin.periodEndsAt.toISOString() : null }
    );
    return billingProjectionOf(updated);
  });
}

function assertCancellable(pin: PinRow, cancel: boolean): void {
  if (!hasPaidSubscription(pin)) {
    throw new InvalidBillingTransitionError("Only a paid Subscription can be set to end at its period end");
  }
  if (cancel && pin.cancelAtPeriodEnd) {
    throw new InvalidBillingTransitionError("The Subscription already ends at its period end");
  }
  if (!cancel && !pin.cancelAtPeriodEnd) {
    throw new InvalidBillingTransitionError("The Subscription is not set to end at its period end");
  }
}

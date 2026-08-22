/**
 * DocuFlow-owned billing state machine (#140, ADR-0010). Trialing, Active,
 * PastDue, ReadOnly, and cancel-at-period-end. Stripe webhooks are not here.
 */

import { auditEvents, workspaceBilling } from "@shared/schema";
import { db } from "../../db";
import { inWorkspace, requireWorkspaceContext, stampWorkspace } from "../../workspaceContext";
import {
  BillingPinMissingError,
  billingProjectionOf,
  InvalidBillingPinError,
  type AuditActor,
  type BillingProjection,
} from "./entitlements";
import { PLAN_REGISTRY, PLAN_REGISTRY_VERSION, type BillingState } from "./planRegistry";

export class InvalidBillingTransitionError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "InvalidBillingTransitionError";
  }
}

type BillingWriter = Pick<typeof db, "insert" | "update" | "select">;

function addUtcDays(from: Date, days: number): Date {
  const next = new Date(from.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function trialDurationDays(): number {
  const days = PLAN_REGISTRY[PLAN_REGISTRY_VERSION]?.trial.trialDurationDays;
  if (days == null) {
    throw new InvalidBillingPinError("Trial duration missing from registry version 1");
  }
  return days;
}

async function loadPin(tx: BillingWriter) {
  const [row] = await tx.select().from(workspaceBilling).where(inWorkspace(workspaceBilling)).limit(1);
  if (!row) throw new BillingPinMissingError();
  return row;
}

async function applyState(
  tx: BillingWriter,
  pin: typeof workspaceBilling.$inferSelect,
  next: BillingState,
  actor: AuditActor,
  reason: string,
  extra: Partial<{
    trialEndsAt: Date | null;
    periodEndsAt: Date | null;
    cancelAtPeriodEnd: boolean;
  }> = {}
): Promise<BillingProjection> {
  const { workspaceId } = requireWorkspaceContext();
  const [updated] = await tx
    .update(workspaceBilling)
    .set({
      billingState: next,
      authorizationVersion: pin.authorizationVersion + 1,
      updatedAt: new Date(),
      ...extra,
    })
    .where(inWorkspace(workspaceBilling))
    .returning();

  await tx.insert(auditEvents).values(
    stampWorkspace({
      actorKind: actor.kind,
      actorId: actor.id ?? null,
      action: "billing.state_transition",
      resourceType: "workspace_billing",
      resourceId: workspaceId,
      payload: { from: pin.billingState, to: next, reason },
    })
  );

  return billingProjectionOf(updated);
}

/**
 * Pin an unpinned Workspace to Plan `trial` / Trialing. No Stripe objects.
 * Duration is the 14-day DocuFlow value from registry version 1.
 */
export async function startTrial(
  actor: AuditActor,
  options: { now?: Date } = {}
): Promise<BillingProjection> {
  const { workspaceId } = requireWorkspaceContext();
  const now = options.now ?? new Date();
  const trialEndsAt = addUtcDays(now, trialDurationDays());
  const seatCapacity = PLAN_REGISTRY[PLAN_REGISTRY_VERSION].trial.seatCapacity;
  if (typeof seatCapacity !== "number") {
    throw new InvalidBillingPinError("Trial seat capacity must be a number");
  }

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(workspaceBilling)
      .where(inWorkspace(workspaceBilling))
      .limit(1);
    if (existing) {
      throw new InvalidBillingTransitionError("Workspace already has a billing pin");
    }

    const [row] = await tx
      .insert(workspaceBilling)
      .values(
        stampWorkspace({
          planKey: "trial",
          registryVersion: PLAN_REGISTRY_VERSION,
          billingState: "Trialing",
          purchasedSeatCapacity: seatCapacity,
          authorizationVersion: 1,
          stripeCustomerId: null,
          stripeSubscriptionId: null,
          trialEndsAt,
          periodEndsAt: null,
          cancelAtPeriodEnd: false,
        })
      )
      .returning();

    await tx.insert(auditEvents).values(
      stampWorkspace({
        actorKind: actor.kind,
        actorId: actor.id ?? null,
        action: "billing.state_transition",
        resourceType: "workspace_billing",
        resourceId: workspaceId,
        payload: { from: null, to: "Trialing", reason: "trial_started" },
      })
    );

    return billingProjectionOf(row);
  });
}

/** Expiry of Trialing without conversion becomes ReadOnly. */
export async function expireTrial(
  actor: AuditActor,
  options: { now?: Date } = {}
): Promise<BillingProjection> {
  const now = options.now ?? new Date();
  return db.transaction(async (tx) => {
    const pin = await loadPin(tx);
    if (pin.billingState !== "Trialing") {
      throw new InvalidBillingTransitionError("Workspace is not Trialing");
    }
    if (!pin.trialEndsAt || now.getTime() < pin.trialEndsAt.getTime()) {
      throw new InvalidBillingTransitionError("Trial has not expired");
    }
    return applyState(tx, pin, "ReadOnly", actor, "trial_expired");
  });
}

/** PastDue keeps full access until the terminal outcome. */
export async function markPastDue(actor: AuditActor): Promise<BillingProjection> {
  return db.transaction(async (tx) => {
    const pin = await loadPin(tx);
    if (pin.billingState === "PastDue") return billingProjectionOf(pin);
    if (pin.billingState !== "Active") {
      throw new InvalidBillingTransitionError("Workspace is not Active");
    }
    return applyState(tx, pin, "PastDue", actor, "past_due");
  });
}

/** Exhausted dunning becomes ReadOnly. */
export async function exhaustDunning(actor: AuditActor): Promise<BillingProjection> {
  return db.transaction(async (tx) => {
    const pin = await loadPin(tx);
    if (pin.billingState === "ReadOnly") return billingProjectionOf(pin);
    if (pin.billingState !== "PastDue") {
      throw new InvalidBillingTransitionError("Workspace is not PastDue");
    }
    return applyState(tx, pin, "ReadOnly", actor, "dunning_exhausted");
  });
}

/**
 * Billing-recovery command: flag cancel-at-period-end. Active, PastDue, and
 * ReadOnly recovery. Trialing has no paid period to cancel.
 */
export async function cancelAtPeriodEnd(
  actor: AuditActor,
  options: { periodEndsAt?: Date } = {}
): Promise<BillingProjection> {
  const { workspaceId } = requireWorkspaceContext();
  return db.transaction(async (tx) => {
    const pin = await loadPin(tx);
    if (pin.billingState === "Trialing") {
      throw new InvalidBillingTransitionError("Trialing Workspaces have no period to cancel");
    }
    const periodEndsAt = options.periodEndsAt ?? pin.periodEndsAt ?? null;
    if (pin.cancelAtPeriodEnd && (options.periodEndsAt == null || pin.periodEndsAt?.getTime() === periodEndsAt?.getTime())) {
      return billingProjectionOf(pin);
    }

    const [updated] = await tx
      .update(workspaceBilling)
      .set({
        cancelAtPeriodEnd: true,
        periodEndsAt,
        authorizationVersion: pin.authorizationVersion + 1,
        updatedAt: new Date(),
      })
      .where(inWorkspace(workspaceBilling))
      .returning();

    await tx.insert(auditEvents).values(
      stampWorkspace({
        actorKind: actor.kind,
        actorId: actor.id ?? null,
        action: "billing.cancel_at_period_end",
        resourceType: "workspace_billing",
        resourceId: workspaceId,
        payload: { periodEndsAt: periodEndsAt ? periodEndsAt.toISOString() : null },
      })
    );

    return billingProjectionOf(updated);
  });
}

/** Cancel-at-period-end reaching period end becomes ReadOnly. */
export async function applyPeriodEnd(
  actor: AuditActor,
  options: { now?: Date } = {}
): Promise<BillingProjection> {
  const now = options.now ?? new Date();
  return db.transaction(async (tx) => {
    const pin = await loadPin(tx);
    if (pin.billingState === "ReadOnly") return billingProjectionOf(pin);
    if (!pin.cancelAtPeriodEnd) {
      throw new InvalidBillingTransitionError("Workspace is not cancelling at period end");
    }
    if (!pin.periodEndsAt || now.getTime() < pin.periodEndsAt.getTime()) {
      throw new InvalidBillingTransitionError("Period has not ended");
    }
    if (pin.billingState !== "Active" && pin.billingState !== "PastDue") {
      throw new InvalidBillingTransitionError("Workspace cannot end the period");
    }
    return applyState(tx, pin, "ReadOnly", actor, "cancel_at_period_end");
  });
}

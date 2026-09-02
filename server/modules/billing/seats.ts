/**
 * Billable Seats (#141, #144, ADR-0008). A seat is an accepted, active Membership.
 * No ledger. Invitation UX is not here; `assertSeatAvailable` is the check
 * Invitation will call. Increases apply immediately and the provider is told
 * afterwards. Decreases apply at period end, floored at consumption.
 */

import { and, count, isNull } from "drizzle-orm";
import { auditEvents, memberships, workspaceBilling } from "@shared/schema";
import { db } from "../../db";
import { inWorkspace, requireWorkspaceContext, stampWorkspace } from "../../workspaceContext";
import {
  BillingPinMissingError,
  billingProjectionOf,
  effectiveEntitlements,
  type AuditActor,
  type BillingProjection,
} from "./entitlements";
import { SeatExhaustedError } from "./writeClassification";
import type { BillingProvider } from "./billingProvider";
import { InvalidBillingTransitionError } from "./stateMachine";

type SeatReader = { select: typeof db.select };

export class SeatCapacityFloorError extends Error {
  readonly statusCode = 400;
  constructor(consumed: number) {
    super(`Purchased seat capacity cannot go below current consumption (${consumed})`);
    this.name = "SeatCapacityFloorError";
  }
}

export class SeatChangeUnavailableError extends Error {
  readonly statusCode = 400;
  constructor() {
    super("Seat changes require a paid Subscription");
    this.name = "SeatChangeUnavailableError";
  }
}

export async function countConsumedSeats(reader: SeatReader = db): Promise<number> {
  const [row] = await reader
    .select({ count: count() })
    .from(memberships)
    .where(and(inWorkspace(memberships), isNull(memberships.archivedAt)));
  return Number(row?.count ?? 0);
}

/** Invitation will call this before send. Adding a Membership uses it too. */
export async function assertSeatAvailable(reader: SeatReader = db): Promise<void> {
  await reader
    .select({ workspaceId: workspaceBilling.workspaceId })
    .from(workspaceBilling)
    .where(inWorkspace(workspaceBilling))
    .for("update");
  const consumed = await countConsumedSeats(reader);
  const { seatCapacity } = await effectiveEntitlements();
  if (consumed + 1 > seatCapacity) {
    throw new SeatExhaustedError();
  }
}

export async function setPurchasedSeatCapacity(
  next: number,
  actor: AuditActor
): Promise<BillingProjection> {
  const { workspaceId } = requireWorkspaceContext();
  return db.transaction(async (tx) => {
    const [pin] = await tx
      .select()
      .from(workspaceBilling)
      .where(inWorkspace(workspaceBilling))
      .for("update")
      .limit(1);
    if (!pin) throw new BillingPinMissingError();

    const consumed = await countConsumedSeats(tx);
    if (next < consumed) throw new SeatCapacityFloorError(consumed);
    if (pin.purchasedSeatCapacity === next) return billingProjectionOf(pin);

    const [updated] = await tx
      .update(workspaceBilling)
      .set({
        purchasedSeatCapacity: next,
        authorizationVersion: pin.authorizationVersion + 1,
        updatedAt: new Date(),
      })
      .where(inWorkspace(workspaceBilling))
      .returning();

    await tx.insert(auditEvents).values(
      stampWorkspace({
        actorKind: actor.kind,
        actorId: actor.id ?? null,
        action: "billing.seats_change",
        resourceType: "workspace_billing",
        resourceId: workspaceId,
        payload: { from: pin.purchasedSeatCapacity, to: next },
      })
    );

    return billingProjectionOf(updated);
  });
}

export async function changeSeats(
  next: number,
  actor: AuditActor,
  provider: BillingProvider
): Promise<BillingProjection> {
  const pin = await getCurrentPin();
  if (pin.planKey !== "pro" || !pin.stripeSubscriptionId) {
    throw new SeatChangeUnavailableError();
  }
  if (next > pin.purchasedSeatCapacity) {
    const updated = await setPurchasedSeatCapacity(next, actor);
    await clearPendingSeatQuantity();
    if (pin.stripeSubscriptionId) {
      await provider.updateSeatQuantity({
        providerSubscriptionId: pin.stripeSubscriptionId,
        seatQuantity: next,
        proration: "create_prorations",
      });
    }
    return updated;
  }

  const consumed = await countConsumedSeats();
  if (next < consumed) throw new SeatCapacityFloorError(consumed);

  const { workspaceId } = requireWorkspaceContext();
  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(workspaceBilling)
      .where(inWorkspace(workspaceBilling))
      .for("update")
      .limit(1);
    if (!locked) throw new BillingPinMissingError();
    if (locked.purchasedSeatCapacity === next) {
      if (locked.pendingSeatQuantity == null) return billingProjectionOf(locked);
      const [cleared] = await tx
        .update(workspaceBilling)
        .set({ pendingSeatQuantity: null, updatedAt: new Date() })
        .where(inWorkspace(workspaceBilling))
        .returning();
      return billingProjectionOf(cleared);
    }

    const [updated] = await tx
      .update(workspaceBilling)
      .set({ pendingSeatQuantity: next, updatedAt: new Date() })
      .where(inWorkspace(workspaceBilling))
      .returning();

    await tx.insert(auditEvents).values(
      stampWorkspace({
        actorKind: actor.kind,
        actorId: actor.id ?? null,
        action: "billing.seats_change_scheduled",
        resourceType: "workspace_billing",
        resourceId: workspaceId,
        payload: { from: locked.purchasedSeatCapacity, to: next },
      })
    );
    return billingProjectionOf(updated);
  });
}

export async function applyPendingSeatDecrease(
  actor: AuditActor,
  provider: BillingProvider,
  options: { now?: Date } = {}
): Promise<BillingProjection> {
  const now = options.now ?? new Date();
  const { workspaceId } = requireWorkspaceContext();
  const result = await db.transaction(async (tx) => {
    const [pin] = await tx
      .select()
      .from(workspaceBilling)
      .where(inWorkspace(workspaceBilling))
      .for("update")
      .limit(1);
    if (!pin) throw new BillingPinMissingError();
    if (pin.pendingSeatQuantity == null) {
      return { projection: billingProjectionOf(pin), tellProvider: false as const };
    }
    if (!pin.periodEndsAt || now.getTime() < pin.periodEndsAt.getTime()) {
      throw new InvalidBillingTransitionError("Period has not ended");
    }

    const consumed = await countConsumedSeats(tx);
    if (pin.pendingSeatQuantity < consumed) throw new SeatCapacityFloorError(consumed);

    const [updated] = await tx
      .update(workspaceBilling)
      .set({
        purchasedSeatCapacity: pin.pendingSeatQuantity,
        pendingSeatQuantity: null,
        authorizationVersion: pin.authorizationVersion + 1,
        updatedAt: new Date(),
      })
      .where(inWorkspace(workspaceBilling))
      .returning();

    await tx.insert(auditEvents).values(
      stampWorkspace({
        actorKind: actor.kind,
        actorId: actor.id ?? null,
        action: "billing.seats_change",
        resourceType: "workspace_billing",
        resourceId: workspaceId,
        payload: { from: pin.purchasedSeatCapacity, to: pin.pendingSeatQuantity },
      })
    );
    return {
      projection: billingProjectionOf(updated),
      tellProvider: pin.stripeSubscriptionId,
    };
  });

  if (typeof result.tellProvider === "string") {
    await provider.updateSeatQuantity({
      providerSubscriptionId: result.tellProvider,
      seatQuantity: result.projection.purchasedSeatCapacity,
      proration: "none",
    });
  }
  return result.projection;
}

/** DocuFlow owns purchased seats after Checkout. Stripe quantity is not authorization truth. */
export function resolveProjectedSeatCapacity(
  pin: {
    purchasedSeatCapacity: number;
    pendingSeatQuantity: number | null;
    periodEndsAt: Date | null;
  },
  subscription: { seatQuantity: number; currentPeriodEnd: Date },
  consumed: number
): {
  purchasedSeatCapacity: number;
  pendingSeatQuantity: number | null;
  tellProvider: boolean;
} {
  const periodRolled =
    pin.periodEndsAt != null &&
    subscription.currentPeriodEnd.getTime() > pin.periodEndsAt.getTime();

  if (pin.pendingSeatQuantity != null && periodRolled) {
    return {
      purchasedSeatCapacity: Math.max(pin.pendingSeatQuantity, consumed),
      pendingSeatQuantity: null,
      tellProvider: true,
    };
  }
  if (pin.purchasedSeatCapacity > subscription.seatQuantity) {
    return {
      purchasedSeatCapacity: pin.purchasedSeatCapacity,
      pendingSeatQuantity: pin.pendingSeatQuantity,
      tellProvider: false,
    };
  }
  return {
    purchasedSeatCapacity: subscription.seatQuantity,
    pendingSeatQuantity: pin.pendingSeatQuantity,
    tellProvider: false,
  };
}

async function getCurrentPin() {
  const [pin] = await db.select().from(workspaceBilling).where(inWorkspace(workspaceBilling)).limit(1);
  if (!pin) throw new BillingPinMissingError();
  return pin;
}

async function clearPendingSeatQuantity(): Promise<void> {
  await db
    .update(workspaceBilling)
    .set({ pendingSeatQuantity: null, updatedAt: new Date() })
    .where(inWorkspace(workspaceBilling));
}

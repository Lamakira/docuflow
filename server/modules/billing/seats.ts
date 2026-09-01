/**
 * Billable Seats (#141, ADR-0008). A seat is an accepted, active Membership.
 * No ledger. Invitation UX is not here; `assertSeatAvailable` is the check
 * Invitation will call. Decreases below consumption are rejected here; applying
 * an allowed decrease at period end is a later ticket.
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

type SeatReader = { select: typeof db.select };

export class SeatCapacityFloorError extends Error {
  readonly statusCode = 400;
  constructor(consumed: number) {
    super(`Purchased seat capacity cannot go below current consumption (${consumed})`);
    this.name = "SeatCapacityFloorError";
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

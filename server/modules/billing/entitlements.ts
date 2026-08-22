/**
 * Effective Entitlements for the current Workspace (#139, ADR-0008).
 * Synchronous read of the billing pin, Plan Registry, and audited overrides.
 */

import {
  auditEvents,
  workspaceBilling,
  workspaceEntitlementOverrides,
} from "@shared/schema";
import { db } from "../../db";
import { inWorkspace, requireWorkspaceContext, stampWorkspace } from "../../workspaceContext";
import {
  deriveEntitlements,
  type EntitlementOverrideValues,
  type Entitlements,
  type PlanKey,
  type BillingState,
} from "./planRegistry";

export class BillingPinMissingError extends Error {
  constructor() {
    super("Workspace has no billing pin");
    this.name = "BillingPinMissingError";
  }
}

export class InvalidBillingPinError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "InvalidBillingPinError";
  }
}

export type BillingProjection = {
  workspaceId: string;
  planKey: PlanKey;
  registryVersion: number;
  billingState: BillingState;
  purchasedSeatCapacity: number;
  authorizationVersion: number;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
};

export type AuditActor = {
  kind: "user" | "service_account" | "system";
  id?: string;
};

function asPlanKey(value: string): PlanKey {
  if (value === "legacy" || value === "trial" || value === "pro") return value;
  throw new InvalidBillingPinError(`Unknown Plan ${value}`);
}

function asBillingState(value: string): BillingState {
  if (
    value === "Trialing" ||
    value === "Active" ||
    value === "PastDue" ||
    value === "ReadOnly"
  ) {
    return value;
  }
  throw new InvalidBillingPinError(`Unknown billing state ${value}`);
}

function overrideValues(
  row:
    | {
        seatCapacity: number | null;
        serviceAccountRequestsPerMinute: number | null;
        workspaceRequestsPerMinute: number | null;
      }
    | undefined
): EntitlementOverrideValues | undefined {
  if (!row) return undefined;
  const overrides: EntitlementOverrideValues = {};
  if (row.seatCapacity != null) overrides.seatCapacity = row.seatCapacity;
  if (row.serviceAccountRequestsPerMinute != null) {
    overrides.serviceAccountRequestsPerMinute = row.serviceAccountRequestsPerMinute;
  }
  if (row.workspaceRequestsPerMinute != null) {
    overrides.workspaceRequestsPerMinute = row.workspaceRequestsPerMinute;
  }
  return Object.keys(overrides).length > 0 ? overrides : undefined;
}

function entitlementsFor(
  pin: {
    planKey: string;
    registryVersion: number;
    billingState: string;
    purchasedSeatCapacity: number;
  },
  override?: {
    seatCapacity: number | null;
    serviceAccountRequestsPerMinute: number | null;
    workspaceRequestsPerMinute: number | null;
  }
): Entitlements {
  return deriveEntitlements({
    planKey: asPlanKey(pin.planKey),
    registryVersion: pin.registryVersion,
    billingState: asBillingState(pin.billingState),
    purchasedSeatCapacity: pin.purchasedSeatCapacity,
    overrides: overrideValues(override),
  });
}

async function loadPin() {
  const [row] = await db
    .select()
    .from(workspaceBilling)
    .where(inWorkspace(workspaceBilling))
    .limit(1);
  if (!row) throw new BillingPinMissingError();
  return row;
}

export async function getBillingProjection(): Promise<BillingProjection> {
  const row = await loadPin();
  return {
    workspaceId: row.workspaceId,
    planKey: asPlanKey(row.planKey),
    registryVersion: row.registryVersion,
    billingState: asBillingState(row.billingState),
    purchasedSeatCapacity: row.purchasedSeatCapacity,
    authorizationVersion: row.authorizationVersion,
    stripeCustomerId: row.stripeCustomerId ?? null,
    stripeSubscriptionId: row.stripeSubscriptionId ?? null,
  };
}

export async function effectiveEntitlements(): Promise<Entitlements> {
  const pin = await loadPin();
  const [override] = await db
    .select()
    .from(workspaceEntitlementOverrides)
    .where(inWorkspace(workspaceEntitlementOverrides))
    .limit(1);
  return entitlementsFor(pin, override);
}

export async function setEntitlementOverride(
  values: EntitlementOverrideValues,
  actor: AuditActor
): Promise<Entitlements> {
  const { workspaceId } = requireWorkspaceContext();
  return db.transaction(async (tx) => {
    const [pin] = await tx
      .select()
      .from(workspaceBilling)
      .where(inWorkspace(workspaceBilling))
      .limit(1);
    if (!pin) throw new BillingPinMissingError();

    const [existing] = await tx
      .select()
      .from(workspaceEntitlementOverrides)
      .where(inWorkspace(workspaceEntitlementOverrides))
      .limit(1);

    const merged = {
      seatCapacity: values.seatCapacity ?? existing?.seatCapacity ?? null,
      serviceAccountRequestsPerMinute:
        values.serviceAccountRequestsPerMinute ??
        existing?.serviceAccountRequestsPerMinute ??
        null,
      workspaceRequestsPerMinute:
        values.workspaceRequestsPerMinute ?? existing?.workspaceRequestsPerMinute ?? null,
      updatedAt: new Date(),
    };

    if (existing) {
      await tx
        .update(workspaceEntitlementOverrides)
        .set(merged)
        .where(inWorkspace(workspaceEntitlementOverrides));
    } else {
      await tx.insert(workspaceEntitlementOverrides).values(stampWorkspace(merged));
    }

    await tx
      .update(workspaceBilling)
      .set({
        authorizationVersion: pin.authorizationVersion + 1,
        updatedAt: new Date(),
      })
      .where(inWorkspace(workspaceBilling));

    await tx.insert(auditEvents).values(
      stampWorkspace({
        actorKind: actor.kind,
        actorId: actor.id ?? null,
        action: "entitlement_override.set",
        resourceType: "workspace_entitlement_overrides",
        resourceId: workspaceId,
        payload: values,
      })
    );

    return entitlementsFor(pin, { ...existing, ...merged });
  });
}

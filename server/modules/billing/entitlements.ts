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
  isFeatureKey,
  isPlanKey,
  type BillingInterval,
  type EntitlementOverrideValues,
  type Entitlements,
  type PlanFeatures,
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
  trialEndsAt: Date | null;
  periodEndsAt: Date | null;
  cancelAtPeriodEnd: boolean;
  billingInterval: BillingInterval | null;
};

export type AuditActor = {
  kind: "user" | "service_account" | "system" | "platform_staff";
  id?: string;
};

function asPlanKey(value: string): PlanKey {
  if (isPlanKey(value)) return value;
  throw new InvalidBillingPinError(`Unknown Plan ${value}`);
}

function asBillingInterval(value: string | null | undefined): BillingInterval | null {
  return value === "monthly" || value === "annual" ? value : null;
}

type OverrideRow = {
  seatCapacity: number | null;
  serviceAccountRequestsPerMinute: number | null;
  workspaceRequestsPerMinute: number | null;
  features?: Record<string, boolean> | null;
};

function featureOverrides(value: Record<string, boolean> | null | undefined): Partial<PlanFeatures> | undefined {
  if (!value) return undefined;
  const known = Object.entries(value).filter(
    ([key, included]) => isFeatureKey(key) && typeof included === "boolean"
  );
  return known.length > 0 ? (Object.fromEntries(known) as Partial<PlanFeatures>) : undefined;
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

function overrideValues(row: OverrideRow | undefined): EntitlementOverrideValues | undefined {
  if (!row) return undefined;
  const overrides: EntitlementOverrideValues = {};
  if (row.seatCapacity != null) overrides.seatCapacity = row.seatCapacity;
  if (row.serviceAccountRequestsPerMinute != null) {
    overrides.serviceAccountRequestsPerMinute = row.serviceAccountRequestsPerMinute;
  }
  if (row.workspaceRequestsPerMinute != null) {
    overrides.workspaceRequestsPerMinute = row.workspaceRequestsPerMinute;
  }
  const features = featureOverrides(row.features);
  if (features) overrides.features = features;
  return Object.keys(overrides).length > 0 ? overrides : undefined;
}

function entitlementsFor(
  pin: {
    planKey: string;
    registryVersion: number;
    billingState: string;
    purchasedSeatCapacity: number;
  },
  override?: OverrideRow
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

export function billingProjectionOf(row: {
  workspaceId: string;
  planKey: string;
  registryVersion: number;
  billingState: string;
  purchasedSeatCapacity: number;
  authorizationVersion: number;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  trialEndsAt: Date | null;
  periodEndsAt: Date | null;
  cancelAtPeriodEnd: boolean;
  billingInterval?: string | null;
}): BillingProjection {
  return {
    workspaceId: row.workspaceId,
    planKey: asPlanKey(row.planKey),
    registryVersion: row.registryVersion,
    billingState: asBillingState(row.billingState),
    purchasedSeatCapacity: row.purchasedSeatCapacity,
    authorizationVersion: row.authorizationVersion,
    stripeCustomerId: row.stripeCustomerId ?? null,
    stripeSubscriptionId: row.stripeSubscriptionId ?? null,
    trialEndsAt: row.trialEndsAt ?? null,
    periodEndsAt: row.periodEndsAt ?? null,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    billingInterval: asBillingInterval(row.billingInterval),
  };
}

/** The Workspace is on a paid Stripe Subscription: it has an id and is Active or PastDue. */
export function hasPaidSubscription(pin: {
  stripeSubscriptionId: string | null;
  billingState: string;
}): boolean {
  return (
    pin.stripeSubscriptionId != null &&
    (pin.billingState === "Active" || pin.billingState === "PastDue")
  );
}

/** An Offered Plan (#314) is Trialing on a Plan other than the `trial` Plan. */
export function isOfferedPlan(pin: { billingState: string; planKey: string }): boolean {
  return pin.billingState === "Trialing" && pin.planKey !== "trial";
}

export async function getBillingProjection(): Promise<BillingProjection> {
  return billingProjectionOf(await loadPin());
}

export type PlanStanding = { projection: BillingProjection; entitlements: Entitlements };

/** The pin and what it entitles, read together so the two cannot disagree. */
export async function planStanding(): Promise<PlanStanding> {
  const pin = await loadPin();
  const [override] = await db
    .select()
    .from(workspaceEntitlementOverrides)
    .where(inWorkspace(workspaceEntitlementOverrides))
    .limit(1);
  return { projection: billingProjectionOf(pin), entitlements: entitlementsFor(pin, override) };
}

export async function effectiveEntitlements(): Promise<Entitlements> {
  return (await planStanding()).entitlements;
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
      features: values.features
        ? { ...(existing?.features ?? {}), ...values.features }
        : (existing?.features ?? null),
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

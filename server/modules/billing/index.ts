import type { BillingPersistence } from "./persistence";
import {
  effectiveEntitlements,
  getBillingProjection,
  setEntitlementOverride,
  type AuditActor,
  type BillingProjection,
} from "./entitlements";
import type { EntitlementOverrideValues, Entitlements } from "./planRegistry";

export type { BillingPersistence };
export type {
  BillingPinInput,
  EntitlementOverrideValues,
  Entitlements,
  PlanDefinition,
  PlanKey,
  PlanRegistry,
  BillingState,
} from "./planRegistry";
export {
  deriveEntitlements,
  PLAN_REGISTRY,
  PLAN_REGISTRY_VERSION,
  PUBLIC_API_RATE_LIMITS,
  UnknownPlanError,
  UnknownRegistryVersionError,
} from "./planRegistry";
export type { AuditActor, BillingProjection } from "./entitlements";
export {
  BillingPinMissingError,
  InvalidBillingPinError,
  effectiveEntitlements,
  getBillingProjection,
  setEntitlementOverride,
} from "./entitlements";

export const BILLING_TABLES = ["workspace_billing", "workspace_entitlement_overrides"] as const;

export interface BillingEntitlementsPersistence {
  getBillingProjection(): Promise<BillingProjection>;
  effectiveEntitlements(): Promise<Entitlements>;
  setEntitlementOverride(
    values: EntitlementOverrideValues,
    actor: AuditActor
  ): Promise<Entitlements>;
}

export const billingPersistence: BillingEntitlementsPersistence = {
  getBillingProjection,
  effectiveEntitlements,
  setEntitlementOverride,
};

export const billingModule = {
  id: "billing",
  name: "Billing",
  tables: BILLING_TABLES,
  persistence: billingPersistence,
} as const;

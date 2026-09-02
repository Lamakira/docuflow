import type { BillingPersistence } from "./persistence";
import { config } from "../../config";
import { billingProviderFromAppConfig } from "./createBillingProvider";
import {
  applyPeriodEnd,
  cancelAtPeriodEnd,
  exhaustDunning,
  expireTrial,
  markPastDue,
  startTrial,
} from "./stateMachine";
import {
  effectiveEntitlements,
  getBillingProjection,
  setEntitlementOverride,
  type AuditActor,
  type BillingProjection,
} from "./entitlements";
import type { EntitlementOverrideValues, Entitlements } from "./planRegistry";
import {
  assertSeatAvailable,
  countConsumedSeats,
  setPurchasedSeatCapacity,
} from "./seats";
import {
  BILLING_DRIFT_JOB,
  BILLING_DRIFT_JOB_TYPE,
  BILLING_PROJECT_JOB,
  BILLING_PROJECT_JOB_TYPE,
  UnknownBillingWebhookError,
  createBillingJobsPort,
  handleBillingDriftJob,
  handleProjectBillingJob,
  ingestBillingWebhook,
  projectWebhookOccurrenceKey,
  driftOccurrenceKey,
  enqueueBillingDriftJobs,
  type IngestBillingWebhookResult,
} from "./projectionJobs";

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
export {
  InvalidBillingTransitionError,
  applyPeriodEnd,
  cancelAtPeriodEnd,
  exhaustDunning,
  expireTrial,
  markPastDue,
  startTrial,
} from "./stateMachine";
export {
  ReadOnlyWorkspaceError,
  SeatExhaustedError,
  assertOperationalWrite,
  assertWriteClass,
} from "./writeClassification";
export type { WriteClass } from "./writeClassification";
export {
  SeatCapacityFloorError,
  SeatChangeUnavailableError,
  assertSeatAvailable,
  countConsumedSeats,
  setPurchasedSeatCapacity,
  changeSeats,
  applyPendingSeatDecrease,
} from "./seats";
export type {
  BillingProvider,
  BillingProviderConfig,
  CheckoutRequest,
  CollectionState,
  HostedBillingSession,
  ProviderCheckoutSession,
  ProviderSubscription,
  SeatQuantityUpdate,
  SeatProration,
  PaymentMethodUpdateRequest,
  WebhookEvent,
} from "./billingProvider";
export {
  BillingProviderClosedError,
  BillingProviderError,
  BillingWebhookSignatureError,
} from "./billingProvider";
export { billingProviderFromAppConfig, createBillingProvider } from "./createBillingProvider";
export {
  BILLING_DRIFT_JOB,
  BILLING_DRIFT_JOB_TYPE,
  BILLING_PROJECT_JOB,
  BILLING_PROJECT_JOB_TYPE,
  UnknownBillingWebhookError,
  createBillingJobsPort,
  handleBillingDriftJob,
  handleProjectBillingJob,
  ingestBillingWebhook,
  projectWebhookOccurrenceKey,
  driftOccurrenceKey,
  enqueueBillingDriftJobs,
  type IngestBillingWebhookResult,
} from "./projectionJobs";
export { applyProviderSubscription, billingStateFromCollection } from "./projection";
export {
  SeededWorkspaceCheckoutError,
  InvalidCheckoutError,
  PaymentMethodUpdateUnavailableError,
  canManageBilling,
  getSubscriptionStatus,
  startCheckout,
  startPaymentMethodUpdate,
} from "./checkout";
export type { StartCheckoutInput, StartPaymentMethodUpdateInput, SubscriptionStatus } from "./checkout";

/** Process-wide BillingProvider. Missing Stripe credentials fail closed on money movement. */
export const billingProvider = billingProviderFromAppConfig(config.billing);

export const BILLING_TABLES = [
  "workspace_billing",
  "workspace_entitlement_overrides",
  "billing_webhook_inbox",
] as const;

export interface BillingEntitlementsPersistence {
  getBillingProjection(): Promise<BillingProjection>;
  effectiveEntitlements(): Promise<Entitlements>;
  setEntitlementOverride(
    values: EntitlementOverrideValues,
    actor: AuditActor
  ): Promise<Entitlements>;
  countConsumedSeats: typeof countConsumedSeats;
  assertSeatAvailable: typeof assertSeatAvailable;
  setPurchasedSeatCapacity: typeof setPurchasedSeatCapacity;
  startTrial: typeof startTrial;
  expireTrial: typeof expireTrial;
  markPastDue: typeof markPastDue;
  exhaustDunning: typeof exhaustDunning;
  cancelAtPeriodEnd: typeof cancelAtPeriodEnd;
  applyPeriodEnd: typeof applyPeriodEnd;
  ingestBillingWebhook: typeof ingestBillingWebhook;
}

export const billingPersistence: BillingEntitlementsPersistence = {
  getBillingProjection,
  effectiveEntitlements,
  setEntitlementOverride,
  countConsumedSeats,
  assertSeatAvailable,
  setPurchasedSeatCapacity,
  startTrial,
  expireTrial,
  markPastDue,
  exhaustDunning,
  cancelAtPeriodEnd,
  applyPeriodEnd,
  ingestBillingWebhook,
};

export const billingModule = {
  id: "billing",
  name: "Billing",
  tables: BILLING_TABLES,
  persistence: billingPersistence,
} as const;

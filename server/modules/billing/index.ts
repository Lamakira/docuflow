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
  BillingInterval,
  BillingPinInput,
  EntitlementOverrideValues,
  Entitlements,
  FeatureKey,
  PlanDefinition,
  PlanFeatures,
  PlanKey,
  PlanRegistry,
  BillingState,
} from "./planRegistry";
export {
  BILLING_INTERVALS,
  deriveEntitlements,
  FEATURE_KEYS,
  FEATURE_LABEL,
  isPlanKey,
  minimumPlanFor,
  placePlan,
  planDefinition,
  PLAN_LABEL,
  PLAN_LADDER,
  PLAN_MIGRATIONS,
  PLAN_REGISTRY,
  PLAN_REGISTRY_VERSION,
  PRICED_PLAN_KEYS,
  PUBLIC_API_RATE_LIMITS,
  UnknownPlanError,
  UnknownRegistryVersionError,
} from "./planRegistry";
export type { AuditActor, BillingProjection, PlanStanding } from "./entitlements";
export {
  BillingPinMissingError,
  InvalidBillingPinError,
  effectiveEntitlements,
  getBillingProjection,
  hasPaidSubscription,
  isOfferedPlan,
  planStanding,
  setEntitlementOverride,
} from "./entitlements";
export type { FeatureMode } from "./featureGate";
export {
  PLAN_UPGRADE_REQUIRED,
  PlanFeatureNotIncludedError,
  assertFeature,
  assertRequestEntitled,
  featureForRequest,
  featureIncluded,
  projectWriteFeature,
} from "./featureGate";
export {
  InvalidBillingTransitionError,
  applyPeriodEnd,
  cancelAtPeriodEnd,
  exhaustDunning,
  expireTrial,
  markPastDue,
  readPlanIntent,
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
  SubscriptionPlanChange,
  PaymentMethodUpdateRequest,
  WebhookEvent,
} from "./billingProvider";
export {
  OfferedPlanUnknownError,
  PaidSubscriptionError,
  extendTrial,
  offerPlan,
  setOperatorCancelAtPeriodEnd,
} from "./operatorCommands";
export type {
  CancelAtPeriodEndUpdate,
  ProviderDispute,
  ProviderInvoice,
  ProviderResourceKind,
} from "./billingProvider";
export {
  BillingCurrencyUnavailableError,
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
  BILLING_EMAIL_JOB,
  BILLING_EMAIL_JOB_TYPE,
  handleBillingEmailJob,
  recordPaymentFailedNotice,
  recordReadOnlyNotice,
  recordTrialEndingNotice,
  recordWelcomeNotice,
} from "./lifecycleEmails";
export type { TrialEndingStage } from "./lifecycleEmails";
export {
  BILLING_EXPIRE_TRIAL_JOB,
  BILLING_EXPIRE_TRIAL_JOB_TYPE,
  enqueueTrialLifecycleJobs,
  handleExpireTrialJob,
} from "./trialLifecycle";
export {
  SeededWorkspaceCheckoutError,
  InvalidCheckoutError,
  PaymentMethodUpdateUnavailableError,
  changePlan,
  getSubscriptionStatus,
  startCheckout,
  startPaymentMethodUpdate,
} from "./checkout";
export type {
  ChangePlanInput,
  StartCheckoutInput,
  StartPaymentMethodUpdateInput,
  SubscriptionStatus,
} from "./checkout";

/** Process-wide BillingProvider. Missing Stripe credentials fail closed on money movement. */
export const billingProvider = billingProviderFromAppConfig(config.billing);

export const BILLING_TABLES = [
  "workspace_billing",
  "workspace_entitlement_overrides",
  "billing_webhook_inbox",
  "billing_payments",
  "payment_disputes",
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

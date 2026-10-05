/**
 * BillingProvider port (#142, ADR-0010, ADR-0027). Application code that talks
 * to Stripe talks only to this surface. Price ids stay inside the adapter.
 */

import type { BillingInterval, PlanKey } from "./planRegistry";

export type BillingProviderConfig = {
  secretKey?: string;
  webhookSecret?: string;
};

export class BillingProviderError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "BillingProviderError";
  }
}

/**
 * The target Plan's Price is not offered in the currency the Subscription is
 * billed in. A Subscription's currency is fixed, so the swap cannot happen.
 */
export class BillingCurrencyUnavailableError extends Error {
  constructor(
    readonly currency: string,
    readonly planLabel: string
  ) {
    const code = currency.toUpperCase();
    super(
      `This Subscription is billed in ${code}, and ${planLabel} is not offered in ${code} yet. ` +
        `To move to ${planLabel}, cancel at period end and choose it through Checkout once the Subscription ends, ` +
        `or ask DocuFlow to add ${code} pricing.`
    );
    this.name = "BillingCurrencyUnavailableError";
  }
}

export class BillingProviderClosedError extends BillingProviderError {
  constructor(detail = "Stripe credentials are not configured") {
    super(detail);
    this.name = "BillingProviderClosedError";
  }
}

export type CheckoutRequest = {
  workspaceId: string;
  planKey: PlanKey;
  interval: BillingInterval;
  seatQuantity: number;
  successUrl: string;
  cancelUrl: string;
  providerCustomerId?: string | null;
};

export type HostedBillingSession = {
  url: string;
  providerSessionId: string;
};

export type ProviderCheckoutSession = {
  workspaceId: string;
  providerSessionId: string;
  providerSubscriptionId: string;
  providerCustomerId: string;
};

/** Provider collection outcome — not the DocuFlow billing state machine. */
export type CollectionState = "Current" | "PastDue" | "Canceled";

export type ProviderSubscription = {
  providerCustomerId: string;
  providerSubscriptionId: string;
  planKey: PlanKey;
  interval: BillingInterval;
  seatQuantity: number;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  collectionState: CollectionState;
  /** Per-seat unit amount in minor units as the provider bills it. Null when the Price is not a flat unit price. */
  unitAmountMinor: number | null;
  /** The Subscription's billing currency, lowercase ISO. */
  currency: string | null;
};

/** An invoice's outcome, as far as telling the Owner and the back office need it. */
export type ProviderInvoice = {
  /** Paid since the failure was reported, so there is nothing left to tell. */
  paid: boolean;
  /** When the provider tries again. Null once it has stopped trying. */
  nextPaymentAttemptAt: Date | null;
  /** Amount due in minor units, in `currency`. */
  amountMinor: number | null;
  currency: string | null;
};

/** A payment dispute as the provider last reported it. */
export type ProviderDispute = {
  providerDisputeId: string;
  providerChargeId: string | null;
  /** The customer the disputed charge belongs to; a dispute event carries none. */
  providerCustomerId: string | null;
  amountMinor: number;
  currency: string;
  reason: string;
  status: string;
  openedAt: Date;
};

export type ProviderResourceKind = "customer" | "subscription" | "invoice" | "dispute";

export type CancelAtPeriodEndUpdate = {
  providerSubscriptionId: string;
  cancel: boolean;
};

export type WebhookEvent = {
  providerEventId: string;
  type: string;
  objectId: string;
  /** The Subscription an invoice event belongs to, read from the signed event. */
  providerSubscriptionId?: string | null;
};

export type SeatProration = "create_prorations" | "none";

export type SeatQuantityUpdate = {
  providerSubscriptionId: string;
  seatQuantity: number;
  proration: SeatProration;
};

export type SubscriptionPlanChange = {
  providerSubscriptionId: string;
  planKey: PlanKey;
  interval: BillingInterval;
};

export type PaymentMethodUpdateRequest = {
  providerCustomerId: string;
  returnUrl: string;
};

export class BillingWebhookSignatureError extends Error {
  constructor() {
    super("invalid signature");
    this.name = "BillingWebhookSignatureError";
  }
}

export interface BillingProvider {
  createCheckout(request: CheckoutRequest): Promise<HostedBillingSession>;
  fetchCheckoutSession(providerSessionId: string): Promise<ProviderCheckoutSession>;
  fetchSubscription(providerSubscriptionId: string): Promise<ProviderSubscription>;
  fetchInvoice(providerInvoiceId: string): Promise<ProviderInvoice>;
  fetchDispute(providerDisputeId: string): Promise<ProviderDispute>;
  updateSeatQuantity(update: SeatQuantityUpdate): Promise<void>;
  /** Moves the Subscription to the Plan's current Price for the interval, prorated. */
  changeSubscriptionPlan(change: SubscriptionPlanChange): Promise<void>;
  /** Back-office command: ends or keeps the Subscription at its period end. */
  setCancelAtPeriodEnd(update: CancelAtPeriodEndUpdate): Promise<void>;
  createPaymentMethodUpdate(request: PaymentMethodUpdateRequest): Promise<HostedBillingSession>;
  verifyWebhook(payload: string, signature: string): Promise<WebhookEvent>;
  /** A link to the provider's own dashboard for staff, or null when none is known. Never an API call. */
  dashboardUrl(kind: ProviderResourceKind, id: string): string | null;
}

export class UnconfiguredBillingProvider implements BillingProvider {
  async createCheckout(): Promise<HostedBillingSession> {
    this.closed();
  }

  async fetchCheckoutSession(): Promise<ProviderCheckoutSession> {
    this.closed();
  }

  async fetchSubscription(): Promise<ProviderSubscription> {
    this.closed();
  }

  async fetchInvoice(): Promise<ProviderInvoice> {
    this.closed();
  }

  async fetchDispute(): Promise<ProviderDispute> {
    this.closed();
  }

  async updateSeatQuantity(): Promise<void> {
    this.closed();
  }

  async setCancelAtPeriodEnd(): Promise<void> {
    this.closed();
  }

  async changeSubscriptionPlan(): Promise<void> {
    this.closed();
  }

  async createPaymentMethodUpdate(): Promise<HostedBillingSession> {
    this.closed();
  }

  async verifyWebhook(): Promise<WebhookEvent> {
    this.closed();
  }

  dashboardUrl(): string | null {
    return null;
  }

  private closed(): never {
    throw new BillingProviderClosedError();
  }
}

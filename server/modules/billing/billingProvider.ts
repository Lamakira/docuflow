/**
 * BillingProvider port (#142, ADR-0010). Application code that talks to Stripe
 * talks only to this surface. Price ids stay inside the adapter.
 */

import type { PlanKey } from "./planRegistry";

export type BillingProviderConfig = {
  secretKey?: string;
  webhookSecret?: string;
  /** Stripe Price ids keyed by Plan. Plans with no mapping have no Stripe objects. */
  priceIds: Partial<Record<PlanKey, string>>;
};

export class BillingProviderError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "BillingProviderError";
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
  seatQuantity: number;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  collectionState: CollectionState;
};

export type WebhookEvent = {
  providerEventId: string;
  type: string;
  objectId: string;
};

export type SeatProration = "create_prorations" | "none";

export type SeatQuantityUpdate = {
  providerSubscriptionId: string;
  seatQuantity: number;
  proration: SeatProration;
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
  updateSeatQuantity(update: SeatQuantityUpdate): Promise<void>;
  createPaymentMethodUpdate(request: PaymentMethodUpdateRequest): Promise<HostedBillingSession>;
  verifyWebhook(payload: string, signature: string): Promise<WebhookEvent>;
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

  async updateSeatQuantity(): Promise<void> {
    this.closed();
  }

  async createPaymentMethodUpdate(): Promise<HostedBillingSession> {
    this.closed();
  }

  async verifyWebhook(): Promise<WebhookEvent> {
    this.closed();
  }

  private closed(): never {
    throw new BillingProviderClosedError();
  }
}

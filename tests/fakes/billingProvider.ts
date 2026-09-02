/**
 * In-memory BillingProvider (ADR-0018: fakes only).
 *
 * Tests speak to the port, not to Stripe types. Checkout is started from a Plan
 * key; Stripe Price ids never appear on this surface.
 *
 * Imports the port module, not the billing barrel, so constructing a fake does
 * not boot the process-wide provider or load `server/config.ts`.
 */

import {
  BillingWebhookSignatureError,
  type BillingProvider,
  type CheckoutRequest,
  type HostedBillingSession,
  type PaymentMethodUpdateRequest,
  type ProviderCheckoutSession,
  type ProviderSubscription,
  type SeatQuantityUpdate,
  type WebhookEvent,
} from "../../server/modules/billing/billingProvider";

export class FakeBillingProvider implements BillingProvider {
  readonly checkouts: CheckoutRequest[] = [];
  readonly fetches: string[] = [];
  readonly checkoutSessions = new Map<string, ProviderCheckoutSession>();
  readonly subscriptions = new Map<string, ProviderSubscription>();
  readonly seatUpdates: SeatQuantityUpdate[] = [];
  readonly paymentMethodUpdates: PaymentMethodUpdateRequest[] = [];

  async createCheckout(request: CheckoutRequest): Promise<HostedBillingSession> {
    this.checkouts.push(request);
    const n = this.checkouts.length;
    const providerSessionId = `cs_fake_${n}`;
    const providerSubscriptionId = `sub_fake_${n}`;
    const providerCustomerId = request.providerCustomerId ?? `cus_fake_${n}`;
    this.checkoutSessions.set(providerSessionId, {
      workspaceId: request.workspaceId,
      providerSessionId,
      providerSubscriptionId,
      providerCustomerId,
    });
    return {
      url: `https://checkout.stripe.test/c/${providerSessionId}`,
      providerSessionId,
    };
  }

  async fetchCheckoutSession(providerSessionId: string): Promise<ProviderCheckoutSession> {
    const session = this.checkoutSessions.get(providerSessionId);
    if (!session) {
      throw new Error(`No Checkout Session ${providerSessionId}`);
    }
    return session;
  }

  async fetchSubscription(providerSubscriptionId: string): Promise<ProviderSubscription> {
    this.fetches.push(providerSubscriptionId);
    const subscription = this.subscriptions.get(providerSubscriptionId);
    if (!subscription) {
      throw new Error(`No Subscription ${providerSubscriptionId}`);
    }
    return subscription;
  }

  async updateSeatQuantity(update: SeatQuantityUpdate): Promise<void> {
    this.seatUpdates.push(update);
  }

  async createPaymentMethodUpdate(
    request: PaymentMethodUpdateRequest
  ): Promise<HostedBillingSession> {
    this.paymentMethodUpdates.push(request);
    const providerSessionId = `bps_fake_${this.paymentMethodUpdates.length}`;
    return {
      url: `https://billing.stripe.test/p/${providerSessionId}`,
      providerSessionId,
    };
  }

  async verifyWebhook(payload: string, signature: string): Promise<WebhookEvent> {
    if (signature !== "signed") throw new BillingWebhookSignatureError();
    return JSON.parse(payload) as WebhookEvent;
  }
}

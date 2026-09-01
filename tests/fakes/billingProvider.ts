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
  type ProviderSubscription,
  type WebhookEvent,
} from "../../server/modules/billing/billingProvider";

export class FakeBillingProvider implements BillingProvider {
  readonly checkouts: CheckoutRequest[] = [];
  readonly subscriptions = new Map<string, ProviderSubscription>();

  async createCheckout(request: CheckoutRequest): Promise<HostedBillingSession> {
    this.checkouts.push(request);
    const providerSessionId = `cs_fake_${this.checkouts.length}`;
    return {
      url: `https://checkout.stripe.test/c/${providerSessionId}`,
      providerSessionId,
    };
  }

  async fetchSubscription(providerSubscriptionId: string): Promise<ProviderSubscription> {
    const subscription = this.subscriptions.get(providerSubscriptionId);
    if (!subscription) {
      throw new Error(`No Subscription ${providerSubscriptionId}`);
    }
    return subscription;
  }

  async verifyWebhook(payload: string, signature: string): Promise<WebhookEvent> {
    if (signature !== "signed") throw new BillingWebhookSignatureError();
    return JSON.parse(payload) as WebhookEvent;
  }
}

/**
 * Stripe BillingProvider adapter (#142, ADR-0010). The only server module that
 * imports `stripe`. Plan keys map to Price ids here; DocuFlow never stores those
 * ids as customer-facing prices.
 */

import Stripe from "stripe";
import {
  BillingProviderClosedError,
  BillingProviderError,
  BillingWebhookSignatureError,
  type BillingProvider,
  type BillingProviderConfig,
  type CheckoutRequest,
  type CollectionState,
  type HostedBillingSession,
  type PaymentMethodUpdateRequest,
  type ProviderCheckoutSession,
  type ProviderSubscription,
  type SeatQuantityUpdate,
  type WebhookEvent,
} from "./billingProvider";
import type { PlanKey } from "./planRegistry";

function idOf(value: string | { id: string } | null | undefined): string | undefined {
  if (!value) return undefined;
  return typeof value === "string" ? value : value.id;
}

const COLLECTION_STATE: Record<string, CollectionState> = {
  active: "Current",
  past_due: "PastDue",
  unpaid: "PastDue",
  canceled: "Canceled",
  incomplete_expired: "Canceled",
};

export class StripeBillingProvider implements BillingProvider {
  private readonly stripe: Stripe;

  constructor(private readonly billing: BillingProviderConfig) {
    if (!billing.secretKey) {
      throw new BillingProviderClosedError();
    }
    this.stripe = new Stripe(billing.secretKey);
  }

  async createCheckout(request: CheckoutRequest): Promise<HostedBillingSession> {
    const price = this.priceIdFor(request.planKey);
    const session = await this.stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price, quantity: request.seatQuantity }],
      success_url: request.successUrl,
      cancel_url: request.cancelUrl,
      client_reference_id: request.workspaceId,
      automatic_tax: { enabled: true },
      billing_address_collection: "required",
      ...(request.providerCustomerId ? { customer: request.providerCustomerId } : {}),
    });
    if (!session.url) {
      throw new BillingProviderError("Checkout Session has no hosted URL");
    }
    return { url: session.url, providerSessionId: session.id };
  }

  async fetchCheckoutSession(providerSessionId: string): Promise<ProviderCheckoutSession> {
    const session = await this.stripe.checkout.sessions.retrieve(providerSessionId);
    const workspaceId = session.client_reference_id;
    const providerSubscriptionId = idOf(session.subscription as string | { id: string } | null);
    const providerCustomerId = idOf(session.customer as string | { id: string } | null);
    if (!workspaceId) {
      throw new BillingProviderError(`Checkout Session ${providerSessionId} has no Workspace`);
    }
    if (!providerSubscriptionId) {
      throw new BillingProviderError(`Checkout Session ${providerSessionId} has no Subscription`);
    }
    if (!providerCustomerId) {
      throw new BillingProviderError(`Checkout Session ${providerSessionId} has no customer`);
    }
    return {
      workspaceId,
      providerSessionId,
      providerSubscriptionId,
      providerCustomerId,
    };
  }

  async fetchSubscription(providerSubscriptionId: string): Promise<ProviderSubscription> {
    const subscription = await this.stripe.subscriptions.retrieve(providerSubscriptionId);
    const item = subscription.items.data[0];
    if (!item) {
      throw new BillingProviderError(`Subscription ${providerSubscriptionId} has no items`);
    }
    const priceId = idOf(item.price);
    if (!priceId) {
      throw new BillingProviderError(`Subscription ${providerSubscriptionId} has no Price`);
    }
    const periodEnd =
      unixPeriodEnd((item as { current_period_end?: unknown }).current_period_end) ??
      unixPeriodEnd((subscription as { current_period_end?: unknown }).current_period_end);
    if (periodEnd == null) {
      throw new BillingProviderError(
        `Subscription ${providerSubscriptionId} has no current period end`
      );
    }
    const providerCustomerId = idOf(subscription.customer);
    if (!providerCustomerId) {
      throw new BillingProviderError(`Subscription ${providerSubscriptionId} has no customer`);
    }
    const collectionState = COLLECTION_STATE[subscription.status];
    if (!collectionState) {
      throw new BillingProviderError(
        `Unknown Stripe subscription status ${subscription.status}`
      );
    }

    return {
      providerCustomerId,
      providerSubscriptionId: subscription.id,
      planKey: this.planKeyFor(priceId),
      seatQuantity: item.quantity ?? 1,
      currentPeriodEnd: new Date(periodEnd * 1000),
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      collectionState,
    };
  }

  async updateSeatQuantity(update: SeatQuantityUpdate): Promise<void> {
    const subscription = await this.stripe.subscriptions.retrieve(update.providerSubscriptionId);
    const item = subscription.items.data[0];
    const itemId = item && "id" in item && typeof item.id === "string" ? item.id : undefined;
    if (!itemId) {
      throw new BillingProviderError(
        `Subscription ${update.providerSubscriptionId} has no items`
      );
    }
    await this.stripe.subscriptions.update(update.providerSubscriptionId, {
      items: [{ id: itemId, quantity: update.seatQuantity }],
      proration_behavior: update.proration,
    });
  }

  async createPaymentMethodUpdate(
    request: PaymentMethodUpdateRequest
  ): Promise<HostedBillingSession> {
    const session = await this.stripe.billingPortal.sessions.create({
      customer: request.providerCustomerId,
      return_url: request.returnUrl,
      flow_data: { type: "payment_method_update" },
    });
    if (!session.url) {
      throw new BillingProviderError("Payment-method session has no hosted URL");
    }
    return { url: session.url, providerSessionId: session.id };
  }

  async verifyWebhook(payload: string, signature: string): Promise<WebhookEvent> {
    if (!this.billing.webhookSecret) {
      throw new BillingProviderClosedError("Stripe webhook secret is not configured");
    }
    try {
      const event = this.stripe.webhooks.constructEvent(
        payload,
        signature,
        this.billing.webhookSecret
      );
      const object = event.data.object as { id?: string };
      return {
        providerEventId: event.id,
        type: event.type,
        objectId: object.id ?? "",
      };
    } catch (error) {
      if (error instanceof BillingWebhookSignatureError) throw error;
      throw new BillingWebhookSignatureError();
    }
  }

  private priceIdFor(planKey: PlanKey): string {
    const priceId = this.billing.priceIds[planKey];
    if (!priceId) {
      throw new BillingProviderError(`Plan ${planKey} has no Stripe Price`);
    }
    return priceId;
  }

  private planKeyFor(priceId: string): PlanKey {
    for (const [planKey, mapped] of Object.entries(this.billing.priceIds)) {
      if (mapped === priceId) return planKey as PlanKey;
    }
    throw new BillingProviderError(`No Plan maps to Stripe Price ${priceId}`);
  }
}

function unixPeriodEnd(value: unknown): number | undefined {
  return typeof value === "number" && value > 0 ? value : undefined;
}

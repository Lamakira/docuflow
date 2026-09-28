/**
 * Stripe BillingProvider adapter (#142, ADR-0010, ADR-0027). The only server
 * module that imports `stripe`.
 *
 * Checkout finds a Plan's Price by the lookup key the Plan Registry names, so
 * moving a lookup key to a new Price changes what new customers pay without a
 * deploy. A Subscription's Plan is read from its Price's Product metadata
 * (`docuflow_plan`), never from the Price id, so a customer on an older Price
 * keeps being recognised. Entitlements never come from Stripe.
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
  type SubscriptionPlanChange,
  type WebhookEvent,
} from "./billingProvider";
import {
  PLAN_REGISTRY_VERSION,
  isPlanKey,
  planDefinition,
  type BillingInterval,
  type PlanKey,
} from "./planRegistry";

/** Product metadata key naming the DocuFlow Plan a Stripe Product sells. */
export const PLAN_METADATA_KEY = "docuflow_plan";

const PRICE_CACHE_MS = 5 * 60_000;

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

const INTERVAL: Record<string, BillingInterval> = { month: "monthly", year: "annual" };

type PriceLike = {
  id: string;
  product?: string | { id: string; metadata?: Record<string, string> | null; deleted?: boolean } | null;
  recurring?: { interval?: string } | null;
};

export class StripeBillingProvider implements BillingProvider {
  private readonly stripe: Stripe;
  private readonly prices = new Map<string, { priceId: string; expiresAt: number }>();

  constructor(
    private readonly billing: BillingProviderConfig,
    private readonly now: () => number = Date.now
  ) {
    if (!billing.secretKey) {
      throw new BillingProviderClosedError();
    }
    this.stripe = new Stripe(billing.secretKey);
  }

  async createCheckout(request: CheckoutRequest): Promise<HostedBillingSession> {
    const price = await this.priceIdFor(request.planKey, request.interval);
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
    const subscription = await this.stripe.subscriptions.retrieve(providerSubscriptionId, {
      expand: ["items.data.price.product"],
    });
    const item = subscription.items.data[0];
    if (!item) {
      throw new BillingProviderError(`Subscription ${providerSubscriptionId} has no items`);
    }
    const price = item.price as unknown as PriceLike | undefined;
    if (!price?.id) {
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
      planKey: await this.planKeyFor(price),
      interval: intervalOf(price),
      seatQuantity: item.quantity ?? 1,
      currentPeriodEnd: new Date(periodEnd * 1000),
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      collectionState,
    };
  }

  async updateSeatQuantity(update: SeatQuantityUpdate): Promise<void> {
    const itemId = await this.subscriptionItemId(update.providerSubscriptionId);
    await this.stripe.subscriptions.update(update.providerSubscriptionId, {
      items: [{ id: itemId, quantity: update.seatQuantity }],
      proration_behavior: update.proration,
    });
  }

  async changeSubscriptionPlan(change: SubscriptionPlanChange): Promise<void> {
    const price = await this.priceIdFor(change.planKey, change.interval);
    const itemId = await this.subscriptionItemId(change.providerSubscriptionId);
    await this.stripe.subscriptions.update(change.providerSubscriptionId, {
      items: [{ id: itemId, price }],
      proration_behavior: "create_prorations",
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

  private async subscriptionItemId(providerSubscriptionId: string): Promise<string> {
    const subscription = await this.stripe.subscriptions.retrieve(providerSubscriptionId);
    const item = subscription.items.data[0];
    const itemId = item && "id" in item && typeof item.id === "string" ? item.id : undefined;
    if (!itemId) {
      throw new BillingProviderError(`Subscription ${providerSubscriptionId} has no items`);
    }
    return itemId;
  }

  /** The active Price behind the Plan's lookup key, cached briefly. */
  private async priceIdFor(planKey: PlanKey, interval: BillingInterval): Promise<string> {
    const lookupKey = planDefinition(planKey, PLAN_REGISTRY_VERSION).lookupKeys?.[interval];
    if (!lookupKey) {
      throw new BillingProviderError(`Plan ${planKey} is not sold through Checkout`);
    }
    const cached = this.prices.get(lookupKey);
    if (cached && cached.expiresAt > this.now()) return cached.priceId;

    const { data } = await this.stripe.prices.list({ lookup_keys: [lookupKey], active: true });
    const price = data.find((candidate) => candidate.lookup_key === lookupKey);
    if (!price) {
      throw new BillingProviderError(
        `No active Stripe Price has lookup key "${lookupKey}" (Plan ${planKey}, ${interval})`
      );
    }
    this.prices.set(lookupKey, { priceId: price.id, expiresAt: this.now() + PRICE_CACHE_MS });
    return price.id;
  }

  private async planKeyFor(price: PriceLike): Promise<PlanKey> {
    const product =
      typeof price.product === "string"
        ? await this.stripe.products.retrieve(price.product)
        : price.product;
    const planKey = product && !product.deleted ? product.metadata?.[PLAN_METADATA_KEY] : undefined;
    if (!planKey || !isPlanKey(planKey)) {
      throw new BillingProviderError(
        `Stripe Price ${price.id} belongs to no Product with ${PLAN_METADATA_KEY} metadata`
      );
    }
    return planKey;
  }
}

function intervalOf(price: PriceLike): BillingInterval {
  const interval = INTERVAL[price.recurring?.interval ?? ""];
  if (!interval) {
    throw new BillingProviderError(`Stripe Price ${price.id} is not billed monthly or yearly`);
  }
  return interval;
}

function unixPeriodEnd(value: unknown): number | undefined {
  return typeof value === "number" && value > 0 ? value : undefined;
}

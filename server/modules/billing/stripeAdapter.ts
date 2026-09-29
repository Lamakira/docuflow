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
  BillingCurrencyUnavailableError,
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
  type ProviderInvoice,
  type ProviderSubscription,
  type SeatQuantityUpdate,
  type SubscriptionPlanChange,
  type WebhookEvent,
} from "./billingProvider";
import {
  PLAN_LABEL,
  PLAN_REGISTRY_VERSION,
  isPlanKey,
  planDefinition,
  type BillingInterval,
  type PlanKey,
} from "./planRegistry";

/** Product metadata key naming the DocuFlow Plan a Stripe Product sells. */
export const PLAN_METADATA_KEY = "docuflow_plan";

const PRICE_CACHE_MS = 5 * 60_000;

/** Stripe's refusal to bill one Customer in two currencies. */
function isCurrencyConflict(error: unknown): boolean {
  return error instanceof Error && /combine currencies/i.test(error.message);
}

type ResolvedPrice = { priceId: string; currencies: string[] };

/**
 * A Stripe SDK failure becomes a BillingProviderError, so the billing routes
 * answer it as a provider fault instead of letting a raw Stripe error escape.
 */
async function fromStripe<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (
      error instanceof BillingProviderError ||
      error instanceof BillingCurrencyUnavailableError ||
      error instanceof BillingWebhookSignatureError
    ) {
      throw error;
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new BillingProviderError(`Stripe could not complete the request: ${detail}`);
  }
}

function idOf(value: string | { id: string } | null | undefined): string | undefined {
  if (!value) return undefined;
  return typeof value === "string" ? value : value.id;
}

/**
 * The Subscription an Invoice belongs to. From API version 2025-03-31.basil it
 * sits under `parent.subscription_details`, before that at `subscription`. A
 * webhook arrives in its endpoint's API version, so both shapes are read.
 */
function subscriptionOfInvoice(invoice: unknown): string | null {
  const shaped = invoice as {
    parent?: { subscription_details?: { subscription?: string | { id: string } | null } | null } | null;
    subscription?: string | { id: string } | null;
  };
  return idOf(shaped.parent?.subscription_details?.subscription) ?? idOf(shaped.subscription) ?? null;
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
  private readonly prices = new Map<string, ResolvedPrice & { expiresAt: number }>();

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
    return fromStripe(() => this.checkout(request));
  }

  /**
   * A returning customer keeps their Stripe Customer. Stripe refuses one whose
   * other billing is locked to another currency than the Price's; Checkout
   * then runs without it and makes a new Customer, which the Subscription
   * projection stores on completion.
   */
  private async checkout(request: CheckoutRequest): Promise<HostedBillingSession> {
    const { priceId } = await this.priceFor(request.planKey, request.interval);
    const create = (customer: string | null | undefined) =>
      this.stripe.checkout.sessions.create({
        mode: "subscription",
        line_items: [{ price: priceId, quantity: request.seatQuantity }],
        success_url: request.successUrl,
        cancel_url: request.cancelUrl,
        client_reference_id: request.workspaceId,
        automatic_tax: { enabled: true },
        billing_address_collection: "required",
        ...(customer ? { customer } : {}),
      });
    let session: Awaited<ReturnType<typeof create>>;
    try {
      session = await create(request.providerCustomerId);
    } catch (error) {
      if (!request.providerCustomerId || !isCurrencyConflict(error)) throw error;
      console.warn(
        `[billing] Customer ${request.providerCustomerId} bills in another currency; Checkout starts without it`
      );
      session = await create(null);
    }
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

  async fetchInvoice(providerInvoiceId: string): Promise<ProviderInvoice> {
    return fromStripe(async () => {
      const invoice = await this.stripe.invoices.retrieve(providerInvoiceId);
      return {
        paid: invoice.status === "paid",
        nextPaymentAttemptAt:
          invoice.next_payment_attempt == null ? null : new Date(invoice.next_payment_attempt * 1000),
      };
    });
  }

  async updateSeatQuantity(update: SeatQuantityUpdate): Promise<void> {
    return fromStripe(async () => {
      const { itemId } = await this.subscriptionItem(update.providerSubscriptionId);
      await this.stripe.subscriptions.update(update.providerSubscriptionId, {
        items: [{ id: itemId, quantity: update.seatQuantity }],
        proration_behavior: update.proration,
      });
    });
  }

  /**
   * A Subscription's currency is fixed. The new Price must be in that currency
   * or carry it in `currency_options`, where Stripe bills the Subscription's
   * currency; otherwise the swap is refused before Stripe is asked.
   */
  async changeSubscriptionPlan(change: SubscriptionPlanChange): Promise<void> {
    return fromStripe(async () => {
      const price = await this.priceFor(change.planKey, change.interval);
      const { itemId, currency } = await this.subscriptionItem(change.providerSubscriptionId);
      if (currency && !price.currencies.includes(currency)) {
        throw new BillingCurrencyUnavailableError(currency, PLAN_LABEL[change.planKey]);
      }
      await this.stripe.subscriptions.update(change.providerSubscriptionId, {
        items: [{ id: itemId, price: price.priceId }],
        proration_behavior: "create_prorations",
      });
    });
  }

  async createPaymentMethodUpdate(
    request: PaymentMethodUpdateRequest
  ): Promise<HostedBillingSession> {
    return fromStripe(async () => {
      const session = await this.stripe.billingPortal.sessions.create({
        customer: request.providerCustomerId,
        return_url: request.returnUrl,
        flow_data: { type: "payment_method_update" },
      });
      if (!session.url) {
        throw new BillingProviderError("Payment-method session has no hosted URL");
      }
      return { url: session.url, providerSessionId: session.id };
    });
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
      const object = event.data.object as { id?: string; object?: string };
      return {
        providerEventId: event.id,
        type: event.type,
        objectId: object.id ?? "",
        ...(object.object === "invoice"
          ? { providerSubscriptionId: subscriptionOfInvoice(object) }
          : {}),
      };
    } catch (error) {
      if (error instanceof BillingWebhookSignatureError) throw error;
      throw new BillingWebhookSignatureError();
    }
  }

  private async subscriptionItem(
    providerSubscriptionId: string
  ): Promise<{ itemId: string; currency: string | undefined }> {
    const subscription = await this.stripe.subscriptions.retrieve(providerSubscriptionId);
    const item = subscription.items.data[0];
    const itemId = item && "id" in item && typeof item.id === "string" ? item.id : undefined;
    if (!itemId) {
      throw new BillingProviderError(`Subscription ${providerSubscriptionId} has no items`);
    }
    const currency = typeof subscription.currency === "string" ? subscription.currency.toLowerCase() : undefined;
    return { itemId, currency };
  }

  /**
   * The active Price behind the Plan's lookup key and every currency it bills
   * in, cached briefly. `currency_options` only comes back when expanded.
   */
  private async priceFor(planKey: PlanKey, interval: BillingInterval): Promise<ResolvedPrice> {
    const lookupKey = planDefinition(planKey, PLAN_REGISTRY_VERSION).lookupKeys?.[interval];
    if (!lookupKey) {
      throw new BillingProviderError(`Plan ${planKey} is not sold through Checkout`);
    }
    const cached = this.prices.get(lookupKey);
    if (cached && cached.expiresAt > this.now()) return cached;

    const { data } = await this.stripe.prices.list({
      lookup_keys: [lookupKey],
      active: true,
      expand: ["data.currency_options"],
    });
    const price = data.find((candidate) => candidate.lookup_key === lookupKey);
    if (!price) {
      throw new BillingProviderError(
        `No active Stripe Price has lookup key "${lookupKey}" (Plan ${planKey}, ${interval})`
      );
    }
    const currencies = [price.currency, ...Object.keys(price.currency_options ?? {})].map((code) =>
      code.toLowerCase()
    );
    const resolved = { priceId: price.id, currencies };
    this.prices.set(lookupKey, { ...resolved, expiresAt: this.now() + PRICE_CACHE_MS });
    return resolved;
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

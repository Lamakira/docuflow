/**
 * In-memory stand-in for the `stripe` package (ADR-0018: fakes only).
 *
 * `vitest.config.ts` aliases `stripe` here, so the BillingProvider adapter
 * never reaches api.stripe.com. Tests of the port use `tests/fakes/billingProvider.ts`;
 * this module exists so loading the adapter under test still cannot call Stripe.
 *
 * Prices and Products mirror the Stripe setup ADR-0027 asks for: one Product
 * per priced Plan carrying `docuflow_plan` metadata, and a monthly and an
 * annual Price per Product, found by lookup key.
 */

export type CheckoutCreateParams = {
  mode?: string;
  line_items?: Array<{ price?: string; quantity?: number }>;
  success_url?: string;
  cancel_url?: string;
  client_reference_id?: string;
  automatic_tax?: { enabled?: boolean };
  billing_address_collection?: string;
  customer?: string;
};

export type FakeProduct = { id: string; metadata: Record<string, string>; deleted?: boolean };

export type FakePrice = {
  id: string;
  lookup_key: string | null;
  active: boolean;
  product: string | FakeProduct;
  recurring: { interval: string } | null;
  /** Defaults to `usd`, as the test-mode Prices ADR-0027 asks for. */
  currency?: string;
  /** Returned only when the list expands `data.currency_options`, as Stripe does. */
  currency_options?: Record<string, { unit_amount: number }>;
};

/** Shaped like the SDK's StripeInvalidRequestError, without importing it. */
export class FakeStripeError extends Error {
  readonly type = "StripeInvalidRequestError";
  constructor(message: string, readonly param?: string) {
    super(message);
  }
}

/**
 * `current_period_end` is optional in both places on purpose. Stripe moved it
 * from the Subscription onto the Subscription item, and a live account on
 * `2026-08-26.dahlia` returns it *only* on the item (#229). Tests need to be
 * able to build either shape, and the one with neither.
 */
export type FakeSubscription = {
  id: string;
  customer: string;
  currency?: string;
  status: string;
  cancel_at_period_end: boolean;
  current_period_end?: number;
  items: {
    data: Array<{
      id?: string;
      quantity: number;
      current_period_end?: number;
      price: { id: string; product?: string | FakeProduct; recurring?: { interval: string } | null };
    }>;
  };
};

/**
 * An Invoice in either API shape: from 2025-03-31.basil its Subscription sits
 * under `parent.subscription_details`, before that at `subscription`.
 */
export type FakeInvoice = {
  id: string;
  object: "invoice";
  status: "draft" | "open" | "paid" | "uncollectible" | "void";
  next_payment_attempt: number | null;
  parent?: { type: string; subscription_details?: { subscription: string } | null } | null;
  subscription?: string | null;
};

export type SubscriptionUpdateParams = {
  items?: Array<{ id?: string; quantity?: number; price?: string }>;
  proration_behavior?: string;
};

export type BillingPortalCreateParams = {
  customer?: string;
  return_url?: string;
  flow_data?: { type?: string };
};

export type PriceListParams = { lookup_keys?: string[]; active?: boolean; expand?: string[] };

const PLAN_PRODUCTS: FakeProduct[] = ["pro", "starter", "growth", "business"].map((plan) => ({
  id: `prod_${plan}`,
  metadata: { docuflow_plan: plan },
}));

function defaultPrices(): FakePrice[] {
  return ["starter", "growth", "business"].flatMap((plan) =>
    (["monthly", "annual"] as const).map((interval) => ({
      id: `price_${plan}_${interval}`,
      lookup_key: `${plan}_${interval}`,
      active: true,
      product: `prod_${plan}`,
      recurring: { interval: interval === "monthly" ? "month" : "year" },
    }))
  );
}

const checkoutSessionCreates: CheckoutCreateParams[] = [];
const billingPortalCreates: BillingPortalCreateParams[] = [];
const subscriptionUpdates: Array<{ id: string } & SubscriptionUpdateParams> = [];
const priceLists: PriceListParams[] = [];
const productRetrieves: string[] = [];
const failures = new Map<string, Error>();
const customerCurrencies = new Map<string, string>();
let retrievedSubscription: FakeSubscription | null = null;
let retrievedInvoice: FakeInvoice | null = null;
let prices: FakePrice[] = defaultPrices();
let products: FakeProduct[] = [...PLAN_PRODUCTS];

export default class Stripe {
  constructor(_apiKey?: string, _opts?: unknown) {}

  checkout = {
    sessions: {
      create: async (params: CheckoutCreateParams) => {
        failIfSet("checkout.sessions.create");
        const locked = params.customer ? customerCurrencies.get(params.customer) : undefined;
        const price = prices.find((candidate) => candidate.id === params.line_items?.[0]?.price);
        if (locked && price && (price.currency ?? "usd") !== locked) {
          throw new FakeStripeError(
            `You cannot combine currencies on a single customer. This customer has had a subscription or payment in ${locked}, but you are trying to pay in ${price.currency ?? "usd"}.`
          );
        }
        checkoutSessionCreates.push(params);
        return {
          id: "cs_test_fake",
          url: "https://checkout.stripe.test/c/cs_test_fake",
        };
      },
      retrieve: async (id: string) => {
        const created = checkoutSessionCreates[0];
        return {
          id,
          client_reference_id: created?.client_reference_id ?? "seeded",
          customer: created?.customer ?? "cus_test_fake",
          subscription: "sub_test_fake",
        };
      },
    },
  };

  subscriptions = {
    retrieve: async (id: string, _params?: { expand?: string[] }): Promise<FakeSubscription> => {
      if (retrievedSubscription) return retrievedSubscription;
      return {
        id,
        customer: "cus_test_fake",
        currency: "usd",
        status: "active",
        cancel_at_period_end: false,
        items: {
          data: [
            {
              id: "si_test_fake",
              quantity: 1,
              current_period_end: 0,
              price: {
                id: "price_pro_test",
                product: PLAN_PRODUCTS[0],
                recurring: { interval: "month" },
              },
            },
          ],
        },
      };
    },
    update: async (id: string, params: SubscriptionUpdateParams) => {
      failIfSet("subscriptions.update");
      // Stripe refuses a Price that cannot bill in the Subscription's currency.
      const currency = retrievedSubscription?.currency ?? "usd";
      for (const item of params.items ?? []) {
        const price = prices.find((candidate) => candidate.id === item.price);
        if (price && (price.currency ?? "usd") !== currency && !price.currency_options?.[currency]) {
          throw new FakeStripeError(
            `The price specified only supports \`${price.currency ?? "usd"}\`. This doesn't match the expected currency: \`${currency}\`.`,
            "items[0][price]"
          );
        }
      }
      subscriptionUpdates.push({ id, ...params });
      return { id };
    },
  };

  prices = {
    list: async (params: PriceListParams) => {
      priceLists.push(params);
      const expanded = params.expand?.includes("data.currency_options") ?? false;
      const data = prices
        .filter(
          (price) =>
            (!params.lookup_keys || (price.lookup_key && params.lookup_keys.includes(price.lookup_key))) &&
            (params.active === undefined || price.active === params.active)
        )
        .map(({ currency_options, ...price }) => ({
          ...price,
          currency: price.currency ?? "usd",
          ...(expanded && currency_options ? { currency_options } : {}),
        }));
      return { object: "list", data, has_more: false };
    },
  };

  products = {
    retrieve: async (id: string): Promise<FakeProduct> => {
      productRetrieves.push(id);
      const product = products.find((candidate) => candidate.id === id);
      if (!product) throw new Error(`No such product: '${id}'`);
      return product;
    },
  };

  billingPortal = {
    sessions: {
      create: async (params: BillingPortalCreateParams) => {
        failIfSet("billingPortal.sessions.create");
        billingPortalCreates.push(params);
        return {
          id: "bps_test_fake",
          url: "https://billing.stripe.test/p/bps_test_fake",
        };
      },
    },
  };

  invoices = {
    retrieve: async (id: string): Promise<FakeInvoice> => {
      if (retrievedInvoice) return retrievedInvoice;
      throw new FakeStripeError(`No such invoice: '${id}'`);
    },
  };

  webhooks = {
    constructEvent: (payload: string, signature: string, secret: string) => {
      if (signature !== `sig:${secret}`) {
        throw new Error("invalid signature");
      }
      return JSON.parse(payload) as {
        id: string;
        type: string;
        data: { object: { id: string } };
      };
    },
  };
}

function failIfSet(method: string): void {
  const error = failures.get(method);
  if (error) throw error;
}

/** Make one SDK method throw, as a Stripe outage or refusal would. */
export function failStripe(
  method: "checkout.sessions.create" | "billingPortal.sessions.create" | "subscriptions.update",
  error: Error = new FakeStripeError("An error occurred with our connection to Stripe.")
): void {
  failures.set(method, error);
}

/** A Customer whose billing Stripe has locked to one currency. */
export function lockCustomerCurrency(customer: string, currency: string): void {
  customerCurrencies.set(customer, currency);
}

export function checkoutCreates(): CheckoutCreateParams[] {
  return checkoutSessionCreates;
}

export function subscriptionUpdateCalls(): Array<{ id: string } & SubscriptionUpdateParams> {
  return subscriptionUpdates;
}

export function billingPortalCreatesLog(): BillingPortalCreateParams[] {
  return billingPortalCreates;
}

export function priceListCalls(): PriceListParams[] {
  return priceLists;
}

export function productRetrieveCalls(): string[] {
  return productRetrieves;
}

export function setRetrievedSubscription(subscription: FakeSubscription | null): void {
  retrievedSubscription = subscription;
}

export function setRetrievedInvoice(invoice: FakeInvoice | null): void {
  retrievedInvoice = invoice;
}

export function setStripePrices(next: FakePrice[]): void {
  prices = next;
}

export function setStripeProducts(next: FakeProduct[]): void {
  products = next;
}

export function resetStripe(): void {
  checkoutSessionCreates.length = 0;
  subscriptionUpdates.length = 0;
  billingPortalCreates.length = 0;
  priceLists.length = 0;
  productRetrieves.length = 0;
  retrievedSubscription = null;
  retrievedInvoice = null;
  failures.clear();
  customerCurrencies.clear();
  prices = defaultPrices();
  products = [...PLAN_PRODUCTS];
}

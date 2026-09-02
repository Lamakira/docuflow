/**
 * In-memory stand-in for the `stripe` package (ADR-0018: fakes only).
 *
 * `vitest.config.ts` aliases `stripe` here, so the BillingProvider adapter
 * never reaches api.stripe.com. Tests of the port use `tests/fakes/billingProvider.ts`;
 * this module exists so loading the adapter under test still cannot call Stripe.
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

export type FakeSubscription = {
  id: string;
  customer: string;
  status: string;
  cancel_at_period_end: boolean;
  items: {
    data: Array<{
      id?: string;
      quantity: number;
      current_period_end: number;
      price: { id: string };
    }>;
  };
};

export type SubscriptionUpdateParams = {
  items?: Array<{ id?: string; quantity?: number }>;
  proration_behavior?: string;
};

export type BillingPortalCreateParams = {
  customer?: string;
  return_url?: string;
  flow_data?: { type?: string };
};

const checkoutSessionCreates: CheckoutCreateParams[] = [];
const billingPortalCreates: BillingPortalCreateParams[] = [];
const subscriptionUpdates: Array<{ id: string } & SubscriptionUpdateParams> = [];
let retrievedSubscription: FakeSubscription | null = null;

export default class Stripe {
  constructor(_apiKey?: string, _opts?: unknown) {}

  checkout = {
    sessions: {
      create: async (params: CheckoutCreateParams) => {
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
    retrieve: async (id: string): Promise<FakeSubscription> => {
      if (retrievedSubscription) return retrievedSubscription;
      return {
        id,
        customer: "cus_test_fake",
        status: "active",
        cancel_at_period_end: false,
        items: {
          data: [
            {
              id: "si_test_fake",
              quantity: 1,
              current_period_end: 0,
              price: { id: "price_pro_test" },
            },
          ],
        },
      };
    },
    update: async (id: string, params: SubscriptionUpdateParams) => {
      subscriptionUpdates.push({ id, ...params });
      return { id };
    },
  };

  billingPortal = {
    sessions: {
      create: async (params: BillingPortalCreateParams) => {
        billingPortalCreates.push(params);
        return {
          id: "bps_test_fake",
          url: "https://billing.stripe.test/p/bps_test_fake",
        };
      },
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

export function checkoutCreates(): CheckoutCreateParams[] {
  return checkoutSessionCreates;
}

export function subscriptionUpdateCalls(): Array<{ id: string } & SubscriptionUpdateParams> {
  return subscriptionUpdates;
}

export function billingPortalCreatesLog(): BillingPortalCreateParams[] {
  return billingPortalCreates;
}

export function setRetrievedSubscription(subscription: FakeSubscription | null): void {
  retrievedSubscription = subscription;
}

export function resetStripe(): void {
  checkoutSessionCreates.length = 0;
  subscriptionUpdates.length = 0;
  billingPortalCreates.length = 0;
  retrievedSubscription = null;
}

import { beforeEach, describe, expect, it } from "vitest";
import { SEEDED_WORKSPACE_ID } from "../../shared/schema";
import { FakeBillingProvider } from "../fakes/billingProvider";
import type { FakeSubscription } from "../fakes/stripe";
import { resetDb } from "../helpers/db";
import { inSeededWorkspace } from "../helpers/workspace";

/**
 * Phase 8 ticket #142: BillingProvider port (ADR-0010, ADR-0018).
 * Seams: the port and its test fake. Stripe types stay inside the adapter.
 * Characterization of `/api/*` stays green.
 */

const CHECKOUT = {
  workspaceId: SEEDED_WORKSPACE_ID,
  planKey: "growth" as const,
  interval: "monthly" as const,
  seatQuantity: 3,
  successUrl: "https://app.docuflow.test/billing/return",
  cancelUrl: "https://app.docuflow.test/billing/cancel",
};

describe("BillingProvider fake", () => {
  it("starts hosted Checkout from a Plan key, not a Stripe Price id", async () => {
    const provider = new FakeBillingProvider();

    const session = await provider.createCheckout(CHECKOUT);

    expect(session.url).toBe("https://checkout.stripe.test/c/cs_fake_1");
    expect(session.providerSessionId).toBe("cs_fake_1");
    expect(provider.checkouts).toEqual([CHECKOUT]);
    expect(JSON.stringify(CHECKOUT)).not.toMatch(/price_/);
  });

  it("re-fetches a provider-neutral Subscription by provider id, keyed by Plan not Price", async () => {
    const provider = new FakeBillingProvider();
    const stored = {
      providerCustomerId: "cus_fake_1",
      providerSubscriptionId: "sub_fake_1",
      planKey: "pro" as const,
      interval: "monthly" as const,
      seatQuantity: 3,
      currentPeriodEnd: new Date("2026-10-01T00:00:00.000Z"),
      cancelAtPeriodEnd: false,
      collectionState: "Current" as const,
    };
    provider.subscriptions.set("sub_fake_1", stored);

    await expect(provider.fetchSubscription("sub_fake_1")).resolves.toEqual(stored);
    expect(JSON.stringify(stored)).not.toMatch(/price_/);
  });

  it("accepts a signed webhook envelope and rejects an unsigned one", async () => {
    const provider = new FakeBillingProvider();
    const payload =
      '{"providerEventId":"evt_fake_1","type":"customer.subscription.updated","objectId":"sub_fake_1"}';

    await expect(provider.verifyWebhook(payload, "signed")).resolves.toEqual({
      providerEventId: "evt_fake_1",
      type: "customer.subscription.updated",
      objectId: "sub_fake_1",
    });
    await expect(provider.verifyWebhook(payload, "unsigned")).rejects.toThrow(
      /unsigned|invalid signature/i
    );
  });
});

describe("BillingProvider without live credentials", () => {
  it("fails closed on Checkout", async () => {
    const { BillingProviderClosedError, createBillingProvider } = await import(
      "../../server/modules/billing"
    );

    const provider = createBillingProvider({ secretKey: undefined });

    await expect(provider.createCheckout(CHECKOUT)).rejects.toBeInstanceOf(
      BillingProviderClosedError
    );
  });

  it("fails closed on the process BillingProvider when credentials are absent", async () => {
    const { BillingProviderClosedError, billingProvider } = await import(
      "../../server/modules/billing"
    );

    await expect(billingProvider.createCheckout(CHECKOUT)).rejects.toBeInstanceOf(
      BillingProviderClosedError
    );
  });

  it("still reads Entitlements for the seeded Workspace", async () => {
    expect(process.env.STRIPE_SECRET_KEY).toBeUndefined();
    await resetDb();

    const { effectiveEntitlements, getBillingProjection } = await import(
      "../../server/modules/billing"
    );

    const pin = await inSeededWorkspace(() => getBillingProjection());
    expect(pin.stripeCustomerId).toBeNull();
    expect(pin.stripeSubscriptionId).toBeNull();

    await expect(inSeededWorkspace(() => effectiveEntitlements())).resolves.toEqual({
      seatCapacity: 500,
      serviceAccountRequestsPerMinute: 60,
      workspaceRequestsPerMinute: 120,
      writesAllowed: true,
      features: {
        activityCapture: true,
        payrollExports: true,
        crm: true,
        projectManagement: true,
        knowledge: true,
        advancedAnalytics: true,
        sso: true,
      },
      screenshotProjectCapacity: null,
    });
  });
});

describe("Plan Registry", () => {
  it("does not store customer-facing prices or Stripe Price ids", async () => {
    const { PLAN_REGISTRY } = await import("../../server/modules/billing");
    for (const catalog of Object.values(PLAN_REGISTRY)) {
      for (const plan of Object.values(catalog)) {
        expect(plan).not.toHaveProperty("price");
        expect(plan).not.toHaveProperty("stripePriceId");
      }
    }
    expect(JSON.stringify(PLAN_REGISTRY)).not.toMatch(/price_/);
  });
});

describe("Stripe adapter", () => {
  beforeEach(async () => {
    const { resetStripe } = await import("../fakes/stripe");
    resetStripe();
  });

  it("finds the Checkout Price by the Plan's lookup key, never by a configured Price id", async () => {
    const { createBillingProvider } = await import("../../server/modules/billing");
    const { checkoutCreates, priceListCalls } = await import("../fakes/stripe");

    const provider = createBillingProvider({ secretKey: "sk_test_fake" });

    const session = await provider.createCheckout(CHECKOUT);

    expect(session).toEqual({
      url: "https://checkout.stripe.test/c/cs_test_fake",
      providerSessionId: "cs_test_fake",
    });
    expect(priceListCalls()).toEqual([
      { lookup_keys: ["growth_monthly"], active: true, expand: ["data.currency_options"] },
    ]);
    expect(checkoutCreates()).toEqual([
      {
        mode: "subscription",
        line_items: [{ price: "price_growth_monthly", quantity: 3 }],
        success_url: CHECKOUT.successUrl,
        cancel_url: CHECKOUT.cancelUrl,
        client_reference_id: CHECKOUT.workspaceId,
        automatic_tax: { enabled: true },
        billing_address_collection: "required",
      },
    ]);
  });

  it("resolves each priced Plan and interval to its own lookup key", async () => {
    const { createBillingProvider } = await import("../../server/modules/billing");
    const { checkoutCreates } = await import("../fakes/stripe");
    const provider = createBillingProvider({ secretKey: "sk_test_fake" });

    for (const planKey of ["starter", "growth", "business"] as const) {
      for (const interval of ["monthly", "annual"] as const) {
        await provider.createCheckout({ ...CHECKOUT, planKey, interval });
      }
    }

    expect(checkoutCreates().map((call) => call.line_items?.[0]?.price)).toEqual([
      "price_starter_monthly",
      "price_starter_annual",
      "price_growth_monthly",
      "price_growth_annual",
      "price_business_monthly",
      "price_business_annual",
    ]);
  });

  it("caches a resolved Price briefly instead of listing Prices on every Checkout", async () => {
    const { StripeBillingProvider } = await import("../../server/modules/billing/stripeAdapter");
    const { checkoutCreates, priceListCalls, setStripePrices } = await import("../fakes/stripe");
    let now = 1_000_000;
    const provider = new StripeBillingProvider({ secretKey: "sk_test_fake" }, () => now);

    await provider.createCheckout(CHECKOUT);
    await provider.createCheckout(CHECKOUT);
    expect(priceListCalls()).toHaveLength(1);

    // The owner moves the lookup key to a new Price; the cache lets it through after it expires.
    setStripePrices([
      {
        id: "price_growth_monthly_2027",
        lookup_key: "growth_monthly",
        active: true,
        product: "prod_growth",
        recurring: { interval: "month" },
      },
    ]);
    now += 10 * 60_000;
    await provider.createCheckout(CHECKOUT);

    expect(priceListCalls()).toHaveLength(2);
    expect(checkoutCreates().map((call) => call.line_items?.[0]?.price)).toEqual([
      "price_growth_monthly",
      "price_growth_monthly",
      "price_growth_monthly_2027",
    ]);
  });

  it("fails clearly when no active Price carries the lookup key", async () => {
    const { BillingProviderError, createBillingProvider } = await import(
      "../../server/modules/billing"
    );
    const { checkoutCreates, setStripePrices } = await import("../fakes/stripe");
    setStripePrices([]);
    const provider = createBillingProvider({ secretKey: "sk_test_fake" });

    const refused = provider.createCheckout({ ...CHECKOUT, planKey: "business", interval: "annual" });

    await expect(refused).rejects.toBeInstanceOf(BillingProviderError);
    await expect(refused).rejects.toThrow(/lookup key "business_annual"/);
    expect(checkoutCreates()).toEqual([]);
  });

  it("refuses Checkout for a Plan that has no lookup keys", async () => {
    const { createBillingProvider } = await import("../../server/modules/billing");
    const provider = createBillingProvider({ secretKey: "sk_test_fake" });

    await expect(
      provider.createCheckout({ ...CHECKOUT, planKey: "enterprise" })
    ).rejects.toThrow(/not sold through Checkout/);
  });

  it("recognises the Plan from the Product's docuflow_plan metadata and the interval from the Price", async () => {
    const periodEnd = new Date("2026-10-01T00:00:00.000Z");
    const { createBillingProvider } = await import("../../server/modules/billing");
    const { setRetrievedSubscription } = await import("../fakes/stripe");

    setRetrievedSubscription({
      id: "sub_test_1",
      customer: "cus_test_1",
      status: "past_due",
      cancel_at_period_end: true,
      items: {
        data: [
          {
            quantity: 2,
            current_period_end: periodEnd.getTime() / 1000,
            price: {
              id: "price_business_annual",
              product: { id: "prod_business", metadata: { docuflow_plan: "business" } },
              recurring: { interval: "year" },
            },
          },
        ],
      },
    });

    const provider = createBillingProvider({ secretKey: "sk_test_fake" });

    await expect(provider.fetchSubscription("sub_test_1")).resolves.toEqual({
      providerCustomerId: "cus_test_1",
      providerSubscriptionId: "sub_test_1",
      planKey: "business",
      interval: "annual",
      seatQuantity: 2,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: true,
      collectionState: "PastDue",
    });
  });

  it("still recognises a grandfathered Price after its lookup key moved to a new Price", async () => {
    const { createBillingProvider } = await import("../../server/modules/billing");
    const { setRetrievedSubscription, setStripePrices } = await import("../fakes/stripe");
    setStripePrices([
      {
        id: "price_starter_monthly_2027",
        lookup_key: "starter_monthly",
        active: true,
        product: "prod_starter",
        recurring: { interval: "month" },
      },
      {
        id: "price_starter_beta",
        lookup_key: null,
        active: false,
        product: "prod_starter",
        recurring: { interval: "month" },
      },
    ]);
    setRetrievedSubscription({
      id: "sub_beta",
      customer: "cus_beta",
      status: "active",
      cancel_at_period_end: false,
      items: {
        data: [
          {
            quantity: 4,
            current_period_end: PERIOD_END_UNIX,
            price: { id: "price_starter_beta", product: "prod_starter", recurring: { interval: "month" } },
          },
        ],
      },
    });

    const subscription = await createBillingProvider({ secretKey: "sk_test_fake" }).fetchSubscription(
      "sub_beta"
    );

    expect(subscription.planKey).toBe("starter");
    expect(subscription.interval).toBe("monthly");
  });

  it("recognises a v1 pro Subscription by its Product metadata", async () => {
    const { setRetrievedSubscription } = await import("../fakes/stripe");
    setRetrievedSubscription(subscriptionWithout({ onItem: PERIOD_END_UNIX }));

    const subscription = await (await adapter()).fetchSubscription("sub_test_1");

    expect(subscription.planKey).toBe("pro");
  });

  it("refuses a Subscription whose Product names no DocuFlow Plan", async () => {
    const { BillingProviderError, createBillingProvider } = await import(
      "../../server/modules/billing"
    );
    const { setRetrievedSubscription, setStripeProducts } = await import("../fakes/stripe");
    setStripeProducts([{ id: "prod_other", metadata: {} }]);
    setRetrievedSubscription({
      id: "sub_other",
      customer: "cus_other",
      status: "active",
      cancel_at_period_end: false,
      items: {
        data: [
          {
            quantity: 1,
            current_period_end: PERIOD_END_UNIX,
            price: { id: "price_other", product: "prod_other", recurring: { interval: "month" } },
          },
        ],
      },
    });

    await expect(
      createBillingProvider({ secretKey: "sk_test_fake" }).fetchSubscription("sub_other")
    ).rejects.toBeInstanceOf(BillingProviderError);
  });

  it("changes Plan by swapping the Subscription item to the new lookup key's Price, prorated", async () => {
    const { subscriptionUpdateCalls } = await import("../fakes/stripe");

    await (await adapter()).changeSubscriptionPlan({
      providerSubscriptionId: "sub_test_1",
      planKey: "business",
      interval: "annual",
    });

    expect(subscriptionUpdateCalls()).toEqual([
      {
        id: "sub_test_1",
        items: [{ id: "si_test_fake", price: "price_business_annual" }],
        proration_behavior: "create_prorations",
      },
    ]);
  });

  function cadSubscription(): FakeSubscription {
    return {
      id: "sub_cad",
      customer: "cus_cad",
      currency: "cad",
      status: "active",
      cancel_at_period_end: false,
      items: {
        data: [
          {
            id: "si_cad",
            quantity: 2,
            current_period_end: PERIOD_END_UNIX,
            price: { id: "price_pro_cad", product: "prod_pro", recurring: { interval: "month" } },
          },
        ],
      },
    };
  }

  it("refuses a Plan change whose Price is not offered in the Subscription's currency, before Stripe is asked", async () => {
    const { BillingCurrencyUnavailableError } = await import("../../server/modules/billing");
    const { setRetrievedSubscription, subscriptionUpdateCalls } = await import("../fakes/stripe");
    setRetrievedSubscription(cadSubscription());

    const refused = (await adapter()).changeSubscriptionPlan({
      providerSubscriptionId: "sub_cad",
      planKey: "business",
      interval: "monthly",
    });

    await expect(refused).rejects.toBeInstanceOf(BillingCurrencyUnavailableError);
    await expect(refused).rejects.toThrow(
      "This Subscription is billed in CAD, and Business is not offered in CAD yet."
    );
    expect(subscriptionUpdateCalls()).toEqual([]);
  });

  it("swaps to a Price that carries the Subscription's currency in currency_options", async () => {
    const { setRetrievedSubscription, setStripePrices, subscriptionUpdateCalls } = await import(
      "../fakes/stripe"
    );
    setRetrievedSubscription(cadSubscription());
    setStripePrices([
      {
        id: "price_business_monthly",
        lookup_key: "business_monthly",
        active: true,
        product: "prod_business",
        recurring: { interval: "month" },
        currency: "usd",
        currency_options: { cad: { unit_amount: 2700 } },
      },
    ]);

    await (await adapter()).changeSubscriptionPlan({
      providerSubscriptionId: "sub_cad",
      planKey: "business",
      interval: "monthly",
    });

    expect(subscriptionUpdateCalls()).toEqual([
      {
        id: "sub_cad",
        items: [{ id: "si_cad", price: "price_business_monthly" }],
        proration_behavior: "create_prorations",
      },
    ]);
  });

  it("turns a raw Stripe failure into a BillingProviderError on Checkout, the portal and a Plan change", async () => {
    const { BillingProviderError } = await import("../../server/modules/billing");
    const { failStripe } = await import("../fakes/stripe");
    failStripe("checkout.sessions.create");
    failStripe("billingPortal.sessions.create");
    failStripe("subscriptions.update");
    const provider = await adapter();

    for (const call of [
      provider.createCheckout(CHECKOUT),
      provider.createPaymentMethodUpdate({ providerCustomerId: "cus_1", returnUrl: "https://app.docuflow.test/b" }),
      provider.changeSubscriptionPlan({ providerSubscriptionId: "sub_1", planKey: "growth", interval: "annual" }),
    ]) {
      await expect(call).rejects.toBeInstanceOf(BillingProviderError);
      await expect(call).rejects.toThrow(/^Stripe could not complete the request: /);
    }
  });

  /**
   * Where the period end lives (#229, Defect A).
   *
   * Stripe moved `current_period_end` from the Subscription onto the
   * Subscription item. The live run on API version `2026-08-26.dahlia` came
   * back with `null` on the Subscription and the real value on the item, so
   * the item-first read in `stripeAdapter` is the only reason a Checkout
   * converts at all — without it `periodEndsAt` is null, the projection Job
   * fails all five attempts, and a paying Workspace stays `Trialing`.
   *
   * It reads like defensive clutter. These three tests are what stop someone
   * deleting half of it.
   */
  const PERIOD_END = new Date("2026-10-16T14:05:41.000Z");
  const PERIOD_END_UNIX = PERIOD_END.getTime() / 1000;

  function subscriptionWithout(
    periodEnd: { onItem?: number; onSubscription?: number }
  ): FakeSubscription {
    return {
      id: "sub_test_1",
      customer: "cus_test_1",
      status: "active",
      cancel_at_period_end: false,
      ...(periodEnd.onSubscription ? { current_period_end: periodEnd.onSubscription } : {}),
      items: {
        data: [
          {
            quantity: 1,
            ...(periodEnd.onItem ? { current_period_end: periodEnd.onItem } : {}),
            price: {
              id: "price_pro_test",
              product: { id: "prod_pro", metadata: { docuflow_plan: "pro" } },
              recurring: { interval: "month" },
            },
          },
        ],
      },
    };
  }

  async function adapter() {
    const { createBillingProvider } = await import("../../server/modules/billing");
    return createBillingProvider({ secretKey: "sk_test_fake" });
  }

  it("reads the period end from the Subscription item when the Subscription has none", async () => {
    const { setRetrievedSubscription } = await import("../fakes/stripe");
    setRetrievedSubscription(subscriptionWithout({ onItem: PERIOD_END_UNIX }));

    const subscription = await (await adapter()).fetchSubscription("sub_test_1");

    expect(subscription.currentPeriodEnd).toEqual(PERIOD_END);
  });

  it("still reads it from the Subscription for an account on an older API version", async () => {
    const { setRetrievedSubscription } = await import("../fakes/stripe");
    setRetrievedSubscription(subscriptionWithout({ onSubscription: PERIOD_END_UNIX }));

    const subscription = await (await adapter()).fetchSubscription("sub_test_1");

    expect(subscription.currentPeriodEnd).toEqual(PERIOD_END);
  });

  it("refuses a Subscription that carries no period end in either place", async () => {
    const { BillingProviderError } = await import("../../server/modules/billing");
    const { setRetrievedSubscription } = await import("../fakes/stripe");
    setRetrievedSubscription(subscriptionWithout({}));

    await expect((await adapter()).fetchSubscription("sub_test_1")).rejects.toBeInstanceOf(
      BillingProviderError
    );
  });
});

describe("Stripe SDK import", () => {
  it("is confined to the BillingProvider adapter", async () => {
    const { readdir, readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");

    async function walk(dir: string): Promise<string[]> {
      const entries = await readdir(dir, { withFileTypes: true });
      const files: string[] = [];
      for (const entry of entries) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) files.push(...(await walk(path)));
        else if (entry.name.endsWith(".ts")) files.push(path);
      }
      return files;
    }

    const files = await walk("server");
    const importers: string[] = [];
    for (const file of files) {
      const source = await readFile(file, "utf8");
      if (/(from|import)\s+["']stripe["']/.test(source)) importers.push(file);
    }

    expect(importers).toEqual(["server/modules/billing/stripeAdapter.ts"]);
  });
});

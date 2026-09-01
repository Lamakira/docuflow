import { beforeEach, describe, expect, it } from "vitest";
import { SEEDED_WORKSPACE_ID } from "../../shared/schema";
import { FakeBillingProvider } from "../fakes/billingProvider";
import { resetDb } from "../helpers/db";
import { inSeededWorkspace } from "../helpers/workspace";

/**
 * Phase 8 ticket #142: BillingProvider port (ADR-0010, ADR-0018).
 * Seams: the port and its test fake. Stripe types stay inside the adapter.
 * Characterization of `/api/*` stays green.
 */

const CHECKOUT = {
  workspaceId: SEEDED_WORKSPACE_ID,
  planKey: "pro" as const,
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

    const provider = createBillingProvider({ secretKey: undefined, priceIds: {} });

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
    });
  });
});

describe("Plan Registry", () => {
  it("does not store customer-facing prices or Stripe Price ids", async () => {
    const { PLAN_REGISTRY } = await import("../../server/modules/billing");
    const catalog = PLAN_REGISTRY[1];

    expect(catalog.legacy).not.toHaveProperty("price");
    expect(catalog.legacy).not.toHaveProperty("stripePriceId");
    expect(catalog.trial).not.toHaveProperty("price");
    expect(catalog.trial).not.toHaveProperty("stripePriceId");
    expect(catalog.pro).not.toHaveProperty("price");
    expect(catalog.pro).not.toHaveProperty("stripePriceId");
    expect(JSON.stringify(PLAN_REGISTRY)).not.toMatch(/price_/);
  });
});

describe("Stripe adapter", () => {
  beforeEach(async () => {
    const { resetStripe } = await import("../fakes/stripe");
    resetStripe();
  });

  it("maps Plan pro to a Stripe Price id on Checkout, not as a DocuFlow price", async () => {
    const { createBillingProvider } = await import("../../server/modules/billing");
    const { checkoutCreates } = await import("../fakes/stripe");

    const provider = createBillingProvider({
      secretKey: "sk_test_fake",
      priceIds: { pro: "price_pro_test" },
    });

    const session = await provider.createCheckout(CHECKOUT);

    expect(session).toEqual({
      url: "https://checkout.stripe.test/c/cs_test_fake",
      providerSessionId: "cs_test_fake",
    });
    expect(checkoutCreates()).toEqual([
      {
        mode: "subscription",
        line_items: [{ price: "price_pro_test", quantity: 3 }],
        success_url: CHECKOUT.successUrl,
        cancel_url: CHECKOUT.cancelUrl,
        client_reference_id: CHECKOUT.workspaceId,
        automatic_tax: { enabled: true },
        billing_address_collection: "required",
      },
    ]);
  });

  it("fails closed when the Plan has no Stripe Price mapping", async () => {
    const { BillingProviderError, createBillingProvider } = await import(
      "../../server/modules/billing"
    );
    const provider = createBillingProvider({
      secretKey: "sk_test_fake",
      priceIds: {},
    });

    await expect(
      provider.createCheckout({ ...CHECKOUT, planKey: "legacy" })
    ).rejects.toBeInstanceOf(BillingProviderError);
  });

  it("re-fetches a Subscription as a Plan key by reversing the adapter Price map", async () => {
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
            price: { id: "price_pro_test" },
          },
        ],
      },
    });

    const provider = createBillingProvider({
      secretKey: "sk_test_fake",
      priceIds: { pro: "price_pro_test" },
    });

    await expect(provider.fetchSubscription("sub_test_1")).resolves.toEqual({
      providerCustomerId: "cus_test_1",
      providerSubscriptionId: "sub_test_1",
      planKey: "pro",
      seatQuantity: 2,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: true,
      collectionState: "PastDue",
    });
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

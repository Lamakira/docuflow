import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Express } from "express";
import { SEEDED_WORKSPACE_ID, workspaceBilling } from "../../shared/schema";
import { FakeBillingProvider } from "../fakes/billingProvider";
import type { FakePrice } from "../fakes/stripe";
import { makeApp } from "../helpers/app";
import { registerUser, setWorkspaceRole, type TestUser } from "../helpers/auth";
import { resetDb, ownerDb } from "../helpers/db";

/**
 * Seat changes and prices on the Billing page (F103, F104). A seat change
 * answers what GET subscription does, a planned decrease included; prices are
 * read from the provider by lookup key and never fail the page. Seam: the
 * billing BFF with the process-wide provider routed to the port fake, and the
 * Stripe adapter over the fake SDK for how a price is chosen and cached.
 */

const SUBSCRIPTION_ID = "sub_seats";
const PERIOD_END = new Date("2026-12-01T00:00:00.000Z");

async function paying(values: Partial<typeof workspaceBilling.$inferInsert> = {}) {
  await ownerDb
    .update(workspaceBilling)
    .set({
      planKey: "growth",
      registryVersion: 2,
      billingState: "Active",
      billingInterval: "monthly",
      purchasedSeatCapacity: 3,
      stripeCustomerId: "cus_seats",
      stripeSubscriptionId: SUBSCRIPTION_ID,
      periodEndsAt: PERIOD_END,
      unitAmountMinor: 1500,
      currency: "cad",
      ...values,
    })
    .where(eq(workspaceBilling.workspaceId, SEEDED_WORKSPACE_ID));
}

async function pin() {
  const [row] = await ownerDb
    .select()
    .from(workspaceBilling)
    .where(eq(workspaceBilling.workspaceId, SEEDED_WORKSPACE_ID));
  return row;
}

async function owner(app: Express): Promise<TestUser> {
  const user = await registerUser(app);
  await setWorkspaceRole(user.id, "owner");
  return user;
}

async function useFake(): Promise<FakeBillingProvider> {
  const { billingProvider } = await import("../../server/modules/billing");
  const fake = new FakeBillingProvider();
  vi.spyOn(billingProvider, "updateSeatQuantity").mockImplementation((update) => fake.updateSeatQuantity(update));
  vi.spyOn(billingProvider, "listPrices").mockImplementation((currency) => fake.listPrices(currency));
  return fake;
}

describe("seat changes from the Billing page", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("answers an increase with the Subscription as GET reads it", async () => {
    const app = await makeApp();
    const user = await owner(app);
    await paying();
    const fake = await useFake();

    const res = await user.agent.post("/api/billing/seats").send({ seatQuantity: 5 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      purchasedSeatCapacity: 5,
      pendingSeatQuantity: null,
      consumedSeatCount: 1,
      unitAmountMinor: 1500,
      currency: "cad",
      canCancel: true,
      canKeep: false,
    });
    expect(res.body).toEqual((await user.agent.get("/api/billing/subscription")).body);
    expect(fake.seatUpdates).toEqual([
      { providerSubscriptionId: SUBSCRIPTION_ID, seatQuantity: 5, proration: "create_prorations" },
    ]);
  });

  it("shows a decrease as planned for the period end, and the current number again clears it", async () => {
    const app = await makeApp();
    const user = await owner(app);
    await paying();
    const fake = await useFake();

    const planned = await user.agent.post("/api/billing/seats").send({ seatQuantity: 2 });
    expect(planned.status).toBe(200);
    expect(planned.body).toMatchObject({ purchasedSeatCapacity: 3, pendingSeatQuantity: 2 });
    expect((await user.agent.get("/api/billing/subscription")).body.pendingSeatQuantity).toBe(2);

    const cleared = await user.agent.post("/api/billing/seats").send({ seatQuantity: 3 });
    expect(cleared.body).toMatchObject({ purchasedSeatCapacity: 3, pendingSeatQuantity: null });
    expect(fake.seatUpdates).toEqual([]);
  });

  it("answers a refused increase with Stripe's message and grants nothing", async () => {
    const { BillingProviderError } = await import("../../server/modules/billing");
    const app = await makeApp();
    const user = await owner(app);
    await paying();
    const fake = await useFake();
    fake.refusal = new BillingProviderError("Stripe could not complete the request: Your card was declined.");

    const res = await user.agent.post("/api/billing/seats").send({ seatQuantity: 6 });
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ message: "Stripe could not complete the request: Your card was declined." });
    expect(await pin()).toMatchObject({ purchasedSeatCapacity: 3, authorizationVersion: 1 });
  });
});

describe("prices on the Billing page", () => {
  beforeEach(async () => {
    await resetDb();
    const { resetStripe } = await import("../fakes/stripe");
    resetStripe();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const PRICES = [
    { planKey: "growth" as const, interval: "monthly" as const, unitAmountMinor: 1500, currency: "cad" },
    { planKey: "growth" as const, interval: "annual" as const, unitAmountMinor: 15000, currency: "cad" },
  ];

  it("reads them in the Subscription's currency for an Owner or Administrator", async () => {
    const app = await makeApp();
    const user = await owner(app);
    await paying();
    const fake = await useFake();
    fake.prices = PRICES;

    const res = await user.agent.get("/api/billing/prices");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ prices: PRICES });
    expect(fake.priceLists).toEqual(["cad"]);
  });

  it("asks for each Price's own currency when there is no Subscription", async () => {
    const app = await makeApp();
    const user = await owner(app);
    const fake = await useFake();

    expect((await user.agent.get("/api/billing/prices")).status).toBe(200);
    expect(fake.priceLists).toEqual([null]);
  });

  it("answers an empty list when the provider cannot answer, or is not configured", async () => {
    const { BillingProviderError } = await import("../../server/modules/billing");
    const app = await makeApp();
    const user = await owner(app);

    const closed = await user.agent.get("/api/billing/prices");
    expect(closed.status).toBe(200);
    expect(closed.body).toEqual({ prices: [] });

    const fake = await useFake();
    fake.refusal = new BillingProviderError("Stripe could not complete the request: timeout");
    const down = await user.agent.get("/api/billing/prices");
    expect(down.status).toBe(200);
    expect(down.body).toEqual({ prices: [] });
  });

  it("keeps them from a Member", async () => {
    const app = await makeApp();
    const member = await registerUser(app);
    const res = await member.agent.get("/api/billing/prices");
    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty("message");
  });

  it("chooses the Subscription's currency where the Price carries it, else the Price's own, and caches ten minutes", async () => {
    const { StripeBillingProvider } = await import("../../server/modules/billing/stripeAdapter");
    const { setStripePrices, priceListCalls } = await import("../fakes/stripe");
    const price = (plan: string, interval: "monthly" | "annual", amount: number, cad?: number) =>
      ({
        id: `price_${plan}_${interval}`,
        lookup_key: `${plan}_${interval}`,
        active: true,
        product: `prod_${plan}`,
        recurring: { interval: interval === "monthly" ? "month" : "year" },
        currency: "usd",
        unit_amount: amount,
        ...(cad ? { currency_options: { usd: { unit_amount: amount }, cad: { unit_amount: cad } } } : {}),
      }) as unknown as FakePrice;
    setStripePrices([price("starter", "monthly", 900), price("growth", "monthly", 1500, 2000)]);
    let now = Date.UTC(2026, 10, 26);
    const stripe = new StripeBillingProvider({ secretKey: "sk_test_fake" }, () => now);

    expect(await stripe.listPrices("cad")).toEqual([
      { planKey: "starter", interval: "monthly", unitAmountMinor: 900, currency: "usd" },
      { planKey: "growth", interval: "monthly", unitAmountMinor: 2000, currency: "cad" },
    ]);
    expect(await stripe.listPrices(null)).toEqual([
      { planKey: "starter", interval: "monthly", unitAmountMinor: 900, currency: "usd" },
      { planKey: "growth", interval: "monthly", unitAmountMinor: 1500, currency: "usd" },
    ]);
    const calls = priceListCalls().length;
    await stripe.listPrices("cad");
    now += 9 * 60_000;
    await stripe.listPrices("cad");
    expect(priceListCalls()).toHaveLength(calls);
    now += 2 * 60_000;
    await stripe.listPrices("cad");
    expect(priceListCalls()).toHaveLength(calls + 1);
  });
});

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Express } from "express";
import {
  PARALLEL_WORKSPACE_ID,
  SEEDED_WORKSPACE_ID,
  workspaceBilling,
} from "../../shared/schema";
import type { FakeSubscription } from "../fakes/stripe";
import { makeApp } from "../helpers/app";
import { registerUser, setWorkspaceRole, type TestUser } from "../helpers/auth";
import { resetDb } from "../helpers/db";
import { addWorkspaceMembership, plantParallelWorkspace } from "../helpers/workspace";

/**
 * A Stripe refusal on a billing route is a `{ message }` answer, never a dead
 * process (#299 follow-up). A Plan change on a CAD Subscription to USD-only
 * Prices threw out of an async Express 4 handler as an unhandled rejection,
 * and Node exited. The routes run the real Stripe adapter over the fake SDK.
 */

async function pinBilling(workspaceId: string, values: Partial<typeof workspaceBilling.$inferInsert>) {
  const { db } = await import("../../server/db");
  await db.update(workspaceBilling).set(values).where(eq(workspaceBilling.workspaceId, workspaceId));
}

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
          quantity: 1,
          current_period_end: Date.UTC(2026, 9, 28) / 1000,
          price: { id: "price_pro_cad", product: "prod_pro", recurring: { interval: "month" } },
        },
      ],
    },
  };
}

/** Route the process-wide provider through a Stripe adapter over the fake SDK. */
async function useStripeAdapter() {
  const { billingProvider } = await import("../../server/modules/billing");
  const { StripeBillingProvider } = await import("../../server/modules/billing/stripeAdapter");
  const stripe = new StripeBillingProvider({ secretKey: "sk_test_fake" });
  vi.spyOn(billingProvider, "changeSubscriptionPlan").mockImplementation((change) =>
    stripe.changeSubscriptionPlan(change)
  );
  vi.spyOn(billingProvider, "createCheckout").mockImplementation((request) => stripe.createCheckout(request));
  vi.spyOn(billingProvider, "createPaymentMethodUpdate").mockImplementation((request) =>
    stripe.createPaymentMethodUpdate(request)
  );
  return billingProvider;
}

async function owner(app: Express): Promise<TestUser> {
  const user = await registerUser(app);
  await setWorkspaceRole(user.id, "owner");
  return user;
}

describe("billing routes answer provider failures (#299)", () => {
  beforeEach(async () => {
    await resetDb();
    const { resetStripe } = await import("../fakes/stripe");
    resetStripe();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("refuses a Plan change to a Price not offered in the Subscription's currency, and keeps serving", async () => {
    const app = await makeApp();
    const admin = await owner(app);
    await pinBilling(SEEDED_WORKSPACE_ID, {
      planKey: "pro",
      registryVersion: 1,
      billingState: "Active",
      stripeCustomerId: "cus_cad",
      stripeSubscriptionId: "sub_cad",
    });
    const { setRetrievedSubscription, subscriptionUpdateCalls } = await import("../fakes/stripe");
    setRetrievedSubscription(cadSubscription());
    await useStripeAdapter();

    const refused = await admin.agent.post("/api/billing/plan").send({ planKey: "business", interval: "monthly" });

    expect(refused.status).toBe(409);
    expect(refused.body).toEqual({
      message:
        "This Subscription is billed in CAD, and Business is not offered in CAD yet. " +
        "To move to Business, cancel at period end and choose it through Checkout once the Subscription ends, " +
        "or ask DocuFlow to add CAD pricing.",
    });
    expect(subscriptionUpdateCalls()).toEqual([]);

    const after = await admin.agent.get("/api/billing/entitlements");
    expect(after.status).toBe(200);
    expect(after.body).toMatchObject({ planKey: "pro", registryVersion: 1 });
  });

  it("changes Plan when the new Price carries the Subscription's currency in currency_options", async () => {
    const app = await makeApp();
    const admin = await owner(app);
    await pinBilling(SEEDED_WORKSPACE_ID, {
      planKey: "pro",
      registryVersion: 1,
      billingState: "Active",
      stripeCustomerId: "cus_cad",
      stripeSubscriptionId: "sub_cad",
    });
    const { setRetrievedSubscription, setStripePrices, subscriptionUpdateCalls } = await import("../fakes/stripe");
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
    await useStripeAdapter();

    const changed = await admin.agent.post("/api/billing/plan").send({ planKey: "business", interval: "monthly" });

    expect(changed.status).toBe(200);
    expect(changed.body).toMatchObject({ planKey: "business", registryVersion: 2, billingInterval: "monthly" });
    expect(subscriptionUpdateCalls()).toHaveLength(1);
  });

  it("answers a Stripe failure on the payment-method portal with a 502 { message }", async () => {
    const app = await makeApp();
    const admin = await owner(app);
    await pinBilling(SEEDED_WORKSPACE_ID, { stripeCustomerId: "cus_cad" });
    const { failStripe } = await import("../fakes/stripe");
    failStripe("billingPortal.sessions.create");
    await useStripeAdapter();

    const res = await admin.agent
      .post("/api/billing/payment-method")
      .send({ returnUrl: "https://app.docuflow.test/administration/billing" });

    expect(res.status).toBe(502);
    expect(res.body).toEqual({
      message: "Stripe could not complete the request: An error occurred with our connection to Stripe.",
    });
    expect((await admin.agent.get("/api/billing/subscription")).status).toBe(200);
  });

  it("answers a Stripe failure on Checkout with a 502 { message }", async () => {
    const app = await makeApp();
    const admin = await registerUser(app);
    await plantParallelWorkspace();
    await addWorkspaceMembership(admin.id, PARALLEL_WORKSPACE_ID, "owner");
    await pinBilling(PARALLEL_WORKSPACE_ID, { planKey: "trial", registryVersion: 2, billingState: "Trialing" });
    expect(
      (await admin.agent.put("/api/memberships/active").send({ workspaceId: PARALLEL_WORKSPACE_ID })).status
    ).toBe(200);
    const { failStripe } = await import("../fakes/stripe");
    failStripe("checkout.sessions.create");
    await useStripeAdapter();

    const res = await admin.agent.post("/api/billing/checkout").send({
      planKey: "growth",
      interval: "annual",
      seatQuantity: 1,
      successUrl: "https://app.docuflow.test/administration/billing",
      cancelUrl: "https://app.docuflow.test/administration/billing",
    });

    expect(res.status).toBe(502);
    expect(res.body).toEqual({
      message: "Stripe could not complete the request: An error occurred with our connection to Stripe.",
    });
  });

  it("hands an unexpected failure to the app's error handler instead of ending the process", async () => {
    const app = await makeApp();
    const admin = await owner(app);
    await pinBilling(SEEDED_WORKSPACE_ID, {
      planKey: "pro",
      registryVersion: 1,
      billingState: "Active",
      stripeSubscriptionId: "sub_cad",
    });
    const provider = await useStripeAdapter();
    vi.mocked(provider.changeSubscriptionPlan).mockRejectedValueOnce(new Error("socket hang up"));

    const res = await admin.agent.post("/api/billing/plan").send({ planKey: "growth", interval: "monthly" });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ message: "socket hang up" });
    expect((await admin.agent.get("/api/billing/entitlements")).status).toBe(200);
  });
});

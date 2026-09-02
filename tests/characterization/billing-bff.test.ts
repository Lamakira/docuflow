import { beforeEach, describe, expect, it } from "vitest";
import { makeApp } from "../helpers/app";
import { registerAdmin, registerUser, setWorkspaceRole } from "../helpers/auth";
import { resetDb } from "../helpers/db";

/**
 * Characterization: freeze the billing web BFF (#144). Session cookies.
 * Owner or Administrator Workspace Role. `{ message }` errors. Frontend v2
 * screens and public `/api/v1` billing resources are out of scope.
 */

describe("billing web BFF (characterization)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("lets an administrator read Plan, state, seats consumed/purchased, and cancel-at-period-end", async () => {
    const app = await makeApp();
    const admin = await registerUser(app);
    await setWorkspaceRole(admin.id, "administrator");

    const res = await admin.agent.get("/api/billing/subscription");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(res.body).toMatchObject({
      planKey: "legacy",
      billingState: "Active",
      cancelAtPeriodEnd: false,
      purchasedSeatCapacity: 500,
      consumedSeatCount: 1,
    });
    expect(res.body.stripeCustomerId).toBeNull();
    expect(res.body.stripeSubscriptionId).toBeNull();
    expect(res.body).not.toHaveProperty("type");
  });

  it("rejects a Member and a users.role admin with { message }, not problem+json", async () => {
    const app = await makeApp();
    const member = await registerUser(app);
    const platformAdmin = await registerAdmin(app);

    const asMember = await member.agent.get("/api/billing/subscription");
    expect(asMember.status).toBe(403);
    expect(asMember.body).toEqual({ message: "Access denied" });
    expect(asMember.body).not.toHaveProperty("type");

    const asPlatformAdmin = await platformAdmin.agent.post("/api/billing/checkout").send({
      planKey: "pro",
      seatQuantity: 3,
      successUrl: "https://app.docuflow.test/billing/return",
      cancelUrl: "https://app.docuflow.test/billing/cancel",
    });
    expect(asPlatformAdmin.status).toBe(403);
    expect(asPlatformAdmin.body).toEqual({ message: "Access denied" });
  });

  it("refuses Checkout on the seeded Workspace and keeps it legacy", async () => {
    const app = await makeApp();
    const admin = await registerUser(app);
    await setWorkspaceRole(admin.id, "owner");

    const checkout = await admin.agent.post("/api/billing/checkout").send({
      planKey: "pro",
      seatQuantity: 3,
      successUrl: "https://app.docuflow.test/billing/return",
      cancelUrl: "https://app.docuflow.test/billing/cancel",
    });
    expect(checkout.status).toBe(400);
    expect(checkout.body).toEqual({ message: "The seeded Workspace cannot start Checkout" });

    const status = await admin.agent.get("/api/billing/subscription");
    expect(status.body).toMatchObject({
      planKey: "legacy",
      billingState: "Active",
      stripeCustomerId: null,
      stripeSubscriptionId: null,
    });
  });

  it("still allows payment-method recovery when the Workspace is ReadOnly", async () => {
    const app = await makeApp();
    const { inSeededWorkspace } = await import("../helpers/workspace");
    const { markPastDue, exhaustDunning } = await import("../../server/modules/billing");
    const admin = await registerUser(app);
    await setWorkspaceRole(admin.id, "owner");
    await inSeededWorkspace(async () => {
      await markPastDue({ kind: "system" });
      await exhaustDunning({ kind: "system" });
    });

    const recovered = await admin.agent.post("/api/billing/payment-method").send({
      returnUrl: "https://app.docuflow.test/billing/return",
    });
    expect(recovered.status).toBe(400);
    expect(recovered.body).toEqual({ message: "Payment-method update requires a Stripe customer" });
    expect(recovered.body).not.toHaveProperty("type");
    expect(recovered.status).not.toBe(403);

    const mutation = await admin.agent.post("/api/crm/clients").send({ name: "Acme" });
    expect(mutation.status).toBe(403);
    expect(mutation.body).toEqual({ message: "Workspace is read-only" });
  });
});

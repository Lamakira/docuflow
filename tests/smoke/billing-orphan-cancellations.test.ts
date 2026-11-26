import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { clearOrphanCancellations } from "../../scripts/clear-orphan-cancellations";
import { openDb } from "../../scripts/lib/db";
import { SEEDED_WORKSPACE_ID, auditEvents, workspaceBilling, workspaces } from "../../shared/schema";
import { FakeBillingProvider } from "../fakes/billingProvider";
import { resetDb, ownerDb } from "../helpers/db";
import { resolveTestDatabaseUrl } from "../test-db-url";

/**
 * The one-off clean-up after F102: cancel at period end used to be set without
 * Stripe, so Workspaces with no Subscription kept the flag for good, and
 * customers whose cancellation Stripe's next event undid go on paying. The
 * first are cleared with --apply; the second are only listed.
 */

const { db, close } = openDb(resolveTestDatabaseUrl());

afterAll(async () => {
  await close();
});

async function plant(id: string, values: Partial<typeof workspaceBilling.$inferInsert>) {
  await ownerDb.insert(workspaces).values({ id, name: id });
  await ownerDb.insert(workspaceBilling).values({
    workspaceId: id,
    planKey: "growth",
    registryVersion: 2,
    billingState: "Active",
    purchasedSeatCapacity: 3,
    authorizationVersion: 1,
    ...values,
  });
}

async function cancelEvent(workspaceId: string, actorKind: string, action: string, createdAt: Date) {
  await ownerDb.insert(auditEvents).values({
    workspaceId,
    actorKind,
    actorId: actorKind === "user" ? "user-1" : null,
    action,
    resourceType: "workspace_billing",
    resourceId: workspaceId,
    payload: {},
    createdAt,
  });
}

async function flagOf(workspaceId: string) {
  const [row] = await ownerDb.select().from(workspaceBilling).where(eq(workspaceBilling.workspaceId, workspaceId));
  return row;
}

describe("clear-orphan-cancellations", () => {
  beforeEach(async () => {
    await resetDb();
    // The Legacy Workspace in the state the dev Workspace is in.
    await ownerDb
      .update(workspaceBilling)
      .set({ cancelAtPeriodEnd: true })
      .where(eq(workspaceBilling.workspaceId, SEEDED_WORKSPACE_ID));
    await plant("ended", { billingState: "ReadOnly", stripeSubscriptionId: "sub_ended", cancelAtPeriodEnd: true });
    await plant("cancelling", { stripeSubscriptionId: "sub_cancelling", cancelAtPeriodEnd: true });
    await plant("lost", { stripeSubscriptionId: "sub_lost", cancelAtPeriodEnd: false });
    await cancelEvent("lost", "user", "billing.cancel_at_period_end", new Date("2026-11-01T10:00:00Z"));
    await plant("undone", { billingState: "PastDue", stripeSubscriptionId: "sub_undone", cancelAtPeriodEnd: false });
    await cancelEvent("undone", "user", "billing.cancel_at_period_end", new Date("2026-11-01T10:00:00Z"));
    await cancelEvent("undone", "platform_staff", "billing.cancel_at_period_end_undone", new Date("2026-11-02T10:00:00Z"));
    await plant("by-staff", { stripeSubscriptionId: "sub_staff", cancelAtPeriodEnd: false });
    await cancelEvent("by-staff", "platform_staff", "billing.cancel_at_period_end", new Date("2026-11-01T10:00:00Z"));
  });

  it("lists, on a dry run, the flags without a Subscription and the lost cancellations, and changes nothing", async () => {
    const lines: string[] = [];
    const result = await clearOrphanCancellations(db, {}, (line) => lines.push(line));

    expect(result.orphans.sort()).toEqual(["ended", SEEDED_WORKSPACE_ID].sort());
    expect(result.cleared).toEqual([]);
    expect(result.lost).toEqual(["lost"]);
    expect(lines.join("\n")).toMatch(/would clear/);
    expect((await flagOf(SEEDED_WORKSPACE_ID)).cancelAtPeriodEnd).toBe(true);
    expect((await flagOf("ended")).cancelAtPeriodEnd).toBe(true);
  });

  it("clears the flags without a Subscription with --apply, audited as the system, and never touches a live one", async () => {
    const result = await clearOrphanCancellations(db, { apply: true });

    expect(result.cleared.sort()).toEqual(["ended", SEEDED_WORKSPACE_ID].sort());
    expect(await flagOf(SEEDED_WORKSPACE_ID)).toMatchObject({ cancelAtPeriodEnd: false, authorizationVersion: 2 });
    expect((await flagOf("ended")).cancelAtPeriodEnd).toBe(false);
    expect((await flagOf("cancelling")).cancelAtPeriodEnd).toBe(true);
    expect((await flagOf("lost")).cancelAtPeriodEnd).toBe(false);
    const [audit] = await ownerDb
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.workspaceId, SEEDED_WORKSPACE_ID), eq(auditEvents.action, "billing.cancel_at_period_end_undone")));
    expect(audit).toMatchObject({ actorKind: "system", actorId: null, payload: { reason: "no_subscription" } });

    const rerun = await clearOrphanCancellations(db, { apply: true });
    expect(rerun.cleared).toEqual([]);
    expect(rerun.lost).toEqual(["lost"]);
  });

  it("lists live Subscriptions flagged to end, and says whether Stripe agrees only when asked to check", async () => {
    await plant("never-sent", { billingState: "PastDue", stripeSubscriptionId: "sub_never_sent", cancelAtPeriodEnd: true });
    const subscription = (id: string, cancelAtPeriodEnd: boolean) => ({
      providerCustomerId: "cus_1",
      providerSubscriptionId: id,
      planKey: "growth" as const,
      interval: "monthly" as const,
      seatQuantity: 3,
      currentPeriodEnd: new Date("2026-12-01T00:00:00Z"),
      cancelAtPeriodEnd,
      collectionState: "Current" as const,
      unitAmountMinor: null,
      currency: null,
    });

    const unchecked = await clearOrphanCancellations(db);
    expect(unchecked.cancelling.sort((a, b) => a.workspaceId.localeCompare(b.workspaceId))).toEqual([
      { workspaceId: "cancelling", stripe: "not checked" },
      { workspaceId: "never-sent", stripe: "not checked" },
    ]);

    const provider = new FakeBillingProvider();
    provider.subscriptions.set("sub_cancelling", subscription("sub_cancelling", true));
    provider.subscriptions.set("sub_never_sent", subscription("sub_never_sent", false));
    const lines: string[] = [];
    const checked = await clearOrphanCancellations(db, { apply: true, checkStripe: provider }, (line) => lines.push(line));
    expect(checked.cancelling.sort((a, b) => a.workspaceId.localeCompare(b.workspaceId))).toEqual([
      { workspaceId: "cancelling", stripe: "agrees" },
      { workspaceId: "never-sent", stripe: "disagrees" },
    ]);
    expect(lines.join("\n")).toMatch(/never-sent: Subscription sub_never_sent, Stripe says it renews/);
    expect((await flagOf("never-sent")).cancelAtPeriodEnd).toBe(true);
    expect((await flagOf("cancelling")).cancelAtPeriodEnd).toBe(true);
    expect(provider.cancelAtPeriodEndUpdates).toEqual([]);

    provider.subscriptions.delete("sub_cancelling");
    const partial = await clearOrphanCancellations(db, { checkStripe: provider });
    expect(partial.cancelling.find((row) => row.workspaceId === "cancelling")?.stripe).toBe("could not answer");
  });
});

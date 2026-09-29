import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { workspaceBilling } from "../../shared/schema";
import { parsePlanIntent } from "../../shared/planIntent";
import { db } from "../../server/db";
import {
  PLAN_INTENT_KEY,
  capturePlanIntent,
  clearPlanIntent,
  readPlanIntent,
} from "../../client/src/lib/planIntent";
import { intendedPricedPlan, planIntentNote, trialNotice, type Entitlements } from "../../client/src/v2/plan";
import { makeApp } from "../helpers/app";
import { registerUser } from "../helpers/auth";
import { resetDb } from "../helpers/db";
import { removeAllMemberships } from "../helpers/workspace";

/**
 * The Plan chosen on the marketing site (#299). `/signup?plan=<name>` is kept
 * through Clerk's sign-up, pinned on the first Workspace's billing row, and
 * offered first by Billing and the Trial banner. It never grants anything.
 */

const source = (file: string) =>
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../client/src", file), "utf8");

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

const plans = (["starter", "growth", "business", "enterprise"] as const).map((planKey) => ({
  planKey,
  label: planKey.charAt(0).toUpperCase() + planKey.slice(1),
  features: {} as Entitlements["features"],
  screenshotProjectCapacity: null,
  priced: planKey !== "enterprise",
}));

function entitlements(overrides: Partial<Entitlements> = {}): Entitlements {
  return {
    planKey: "trial",
    planLabel: "Trial",
    registryVersion: 2,
    billingState: "Trialing",
    billingInterval: null,
    trialEndsAt: "2026-10-05T12:00:00.000Z",
    intendedPlanKey: null,
    intendedInterval: null,
    features: {} as Entitlements["features"],
    screenshotProjectCapacity: null,
    requiredPlan: {} as Entitlements["requiredPlan"],
    plans,
    ...overrides,
  };
}

describe("reading ?plan= from the pricing page", () => {
  it("accepts the four pricing-page Plans and ignores anything else", () => {
    expect(parsePlanIntent("Growth", "ANNUAL")).toEqual({ planKey: "growth", interval: "annual" });
    expect(parsePlanIntent("enterprise")).toEqual({ planKey: "enterprise", interval: null });
    expect(parsePlanIntent("growth", "weekly")).toEqual({ planKey: "growth", interval: null });
    expect(parsePlanIntent("trial")).toBeNull();
    expect(parsePlanIntent("legacy")).toBeNull();
    expect(parsePlanIntent(undefined)).toBeNull();
    expect(parsePlanIntent(42)).toBeNull();
  });

  it("keeps a valid choice until the first Workspace takes it", () => {
    const storage = memoryStorage();
    expect(capturePlanIntent("?plan=growth&interval=annual", storage)).toEqual({
      planKey: "growth",
      interval: "annual",
    });
    // Clerk's redirect lands without the query string; the choice survives.
    expect(capturePlanIntent("", storage)).toBeNull();
    expect(capturePlanIntent("?plan=platinum", storage)).toBeNull();
    expect(readPlanIntent(storage)).toEqual({ planKey: "growth", interval: "annual" });

    clearPlanIntent(storage);
    expect(readPlanIntent(storage)).toBeNull();
  });

  it("reads a tampered stored value as no choice", () => {
    const storage = memoryStorage();
    storage.setItem(PLAN_INTENT_KEY, "{not json");
    expect(readPlanIntent(storage)).toBeNull();
    storage.setItem(PLAN_INTENT_KEY, JSON.stringify({ planKey: "trial" }));
    expect(readPlanIntent(storage)).toBeNull();
  });

  it("captures on the sign-up page and sends it with the first Workspace", () => {
    expect(source("pages/AuthPage.tsx")).toContain("capturePlanIntent(window.location.search)");
    const first = source("v2/V2FirstWorkspace.tsx");
    expect(first).toContain("intendedPlan: intent.planKey, intendedInterval: intent.interval");
    expect(first).toContain("clearPlanIntent();");
  });
});

describe("pinning the choice on the first Workspace", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("records a valid Plan and interval and reports them with the Entitlements", async () => {
    const app = await makeApp();
    const user = await registerUser(app, { firstName: "Ana" });
    await removeAllMemberships(user.id);

    const created = await user.agent
      .post("/api/workspaces")
      .send({ name: "Keystone", intendedPlan: "growth", intendedInterval: "annual" });
    expect(created.status).toBe(201);

    const [billing] = await db
      .select()
      .from(workspaceBilling)
      .where(eq(workspaceBilling.workspaceId, created.body.workspaceId));
    expect(billing.planKey).toBe("trial");
    expect(billing.billingState).toBe("Trialing");
    expect(billing.intendedPlanKey).toBe("growth");
    expect(billing.intendedBillingInterval).toBe("annual");

    const summary = await user.agent.get("/api/billing/entitlements");
    expect(summary.status).toBe(200);
    expect(summary.body).toMatchObject({
      planKey: "trial",
      intendedPlanKey: "growth",
      intendedInterval: "annual",
    });
  });

  it("keeps Enterprise as intent and ignores an unknown Plan", async () => {
    const app = await makeApp();
    const enterprise = await registerUser(app, { firstName: "Eve" });
    await removeAllMemberships(enterprise.id);
    const kept = await enterprise.agent
      .post("/api/workspaces")
      .send({ name: "Sales-led", intendedPlan: "Enterprise" });
    expect(kept.status).toBe(201);
    const [pin] = await db
      .select()
      .from(workspaceBilling)
      .where(eq(workspaceBilling.workspaceId, kept.body.workspaceId));
    expect(pin.intendedPlanKey).toBe("enterprise");
    expect(pin.intendedBillingInterval).toBeNull();

    const other = await registerUser(app, { firstName: "Oli" });
    await removeAllMemberships(other.id);
    const ignored = await other.agent
      .post("/api/workspaces")
      .send({ name: "Unknown", intendedPlan: "platinum", intendedInterval: "annual" });
    expect(ignored.status).toBe(201);
    const [none] = await db
      .select()
      .from(workspaceBilling)
      .where(eq(workspaceBilling.workspaceId, ignored.body.workspaceId));
    expect(none.intendedPlanKey).toBeNull();
    expect(none.intendedBillingInterval).toBeNull();
    expect((await other.agent.get("/api/billing/entitlements")).body.intendedPlanKey).toBeNull();
  });
});

describe("Billing preselection", () => {
  it("opens on the chosen Plan during the Trial and in Read-only after it", () => {
    const growth = entitlements({ intendedPlanKey: "growth", intendedInterval: "annual" });
    expect(intendedPricedPlan(growth)).toBe("growth");
    expect(planIntentNote(growth)).toBe("You chose Growth when you signed up.");

    const expired = entitlements({ billingState: "ReadOnly", intendedPlanKey: "growth" });
    expect(intendedPricedPlan(expired)).toBe("growth");
    expect(planIntentNote(expired)).toBe("You chose Growth when you signed up.");
  });

  it("steps aside once a Plan was bought", () => {
    const bought = entitlements({ planKey: "starter", billingState: "Active", intendedPlanKey: "growth" });
    expect(intendedPricedPlan(bought)).toBeNull();
    expect(planIntentNote(bought)).toBeNull();
    const ended = entitlements({ planKey: "starter", billingState: "ReadOnly", intendedPlanKey: "growth" });
    expect(intendedPricedPlan(ended)).toBeNull();
  });

  it("names Enterprise as sales-led without preselecting a card", () => {
    const enterprise = entitlements({ intendedPlanKey: "enterprise" });
    expect(intendedPricedPlan(enterprise)).toBeNull();
    expect(planIntentNote(enterprise)).toContain("You chose Enterprise when you signed up.");
    expect(planIntentNote(enterprise)).toContain("agreed with DocuFlow sales");
    expect(planIntentNote(entitlements())).toBeNull();
  });

  it("feeds the Plan cards and the interval from the choice", () => {
    const page = source("v2/V2Administration.tsx");
    expect(page).toContain("chosenPlan ?? currentPriced ?? intendedPricedPlan(entitlements) ?? \"business\"");
    expect(page).toContain("entitlements?.billingInterval ?? entitlements?.intendedInterval ?? \"monthly\"");
    expect(page).toContain('data-testid="v2-administration-plan-intent"');
  });
});

describe("Trial banner", () => {
  const now = new Date("2026-09-28T12:00:00.000Z");

  it("counts down and continues with the chosen Plan", () => {
    expect(trialNotice(entitlements({ intendedPlanKey: "growth" }), now)).toEqual({
      copy: "Your Trial ends in 7 days.",
      action: "Continue with Growth",
    });
  });

  it("offers a neutral choice without a priced intent", () => {
    expect(trialNotice(entitlements(), now)?.action).toBe("Choose a Plan");
    expect(trialNotice(entitlements({ intendedPlanKey: "enterprise" }), now)?.action).toBe("Choose a Plan");
  });

  it("says one day and today, and is absent outside the Trial", () => {
    expect(trialNotice(entitlements({ trialEndsAt: "2026-09-29T06:00:00.000Z" }), now)?.copy).toBe(
      "Your Trial ends in 1 day.",
    );
    expect(trialNotice(entitlements({ trialEndsAt: "2026-09-28T06:00:00.000Z" }), now)?.copy).toBe(
      "Your Trial ends today.",
    );
    expect(trialNotice(entitlements({ billingState: "ReadOnly" }), now)).toBeNull();
    expect(trialNotice(null, now)).toBeNull();
  });

  it("sits where the Plan banner does and links to Billing", () => {
    const shell = source("v2/V2Shell.tsx");
    expect(shell).toContain('data-testid="v2-trial-banner"');
    expect(shell).toContain('<Link href={administrationTabHref("billing")}>{trial.action}</Link>');
  });
});

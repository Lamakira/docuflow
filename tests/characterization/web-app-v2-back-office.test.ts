import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  backOfficeTabs,
  composeAuditLog,
  composeBreakGlass,
  composeDisputes,
  composeStats,
  composeSubscriptions,
  composeSupportAccess,
  composeSupportRequest,
  composeSupportRequests,
  composeUserWorkspaces,
  composeWorkspacePage,
  composeWorkspaceRegister,
  planFilterOptions,
  formatMoney,
  offeredPlanBody,
  parseBackOfficePath,
  platformAuditEventsPath,
  supportRequestHref,
  trialExtensionBody,
  validateBreakGlassReason,
  validateSupportEntry,
  workspacePageHref,
  type BackOfficeStatus,
  type PlatformStats,
  type PlatformSupportRequestDetail,
  type PlatformWorkspaceDetail,
  type PlatformWorkspaceRow,
} from "../../client/src/v2/backOffice";
import { supportRequestCategories, validateSupportRequest } from "../../client/src/v2/help";
import { breadcrumbFor, matchV2Route, navIdForPath } from "../../client/src/v2/presentation";

/**
 * The back office (#314). Seams: the composers in backOffice.ts, the help
 * validation and the routing. Pure: no server, no database.
 */

const here = dirname(fileURLToPath(import.meta.url));
const read = (path: string) => readFileSync(join(here, "../..", path), "utf8");
const now = new Date(2026, 9, 5, 12, 0, 0);

function row(overrides: Partial<PlatformWorkspaceRow> & { id: string }): PlatformWorkspaceRow {
  return {
    name: `Workspace ${overrides.id}`,
    owner: { userId: "u1", name: "Olive Owner", email: "olive@example.com" },
    planKey: "business",
    planLabel: "Business",
    billingState: "Active",
    status: "active",
    billingInterval: "monthly",
    seatsUsed: 3,
    seatsPurchased: 5,
    memberCount: 4,
    trialEndsAt: null,
    periodEndsAt: "2026-11-01T00:00:00.000Z",
    cancelAtPeriodEnd: false,
    hasPaidSubscription: true,
    createdAt: "2026-01-10T00:00:00.000Z",
    lastActivityAt: null,
    ...overrides,
  };
}

const statuses: BackOfficeStatus[] = ["trial", "offered", "active", "past_due", "read_only", "cancelled"];
const rows = statuses.map((status) => row({ id: status, name: `Acme ${status}`, status }));

describe("tabs and routes", () => {
  it("names six tabs with their hrefs", () => {
    expect(backOfficeTabs("stats").map((tab) => [tab.id, tab.href, tab.current])).toEqual([
      ["workspaces", "/platform/workspaces", false],
      ["users", "/platform/users", false],
      ["subscriptions", "/platform/subscriptions", false],
      ["disputes", "/platform/disputes", false],
      ["stats", "/platform/stats", true],
      ["access", "/platform/access", false],
    ]);
  });

  it("reads every back-office path", () => {
    expect(parseBackOfficePath("/platform")).toEqual({ kind: "tab", tab: "workspaces" });
    expect(parseBackOfficePath("/platform/users")).toEqual({ kind: "tab", tab: "users" });
    expect(parseBackOfficePath("/platform/workspaces/w1")).toEqual({ kind: "workspace", tab: "workspaces", workspaceId: "w1" });
    expect(parseBackOfficePath("/platform/disputes/requests/r1")).toEqual({
      kind: "support-request",
      tab: "disputes",
      requestId: "r1",
    });
    expect(parseBackOfficePath("/platform/nothing")).toBeNull();
    expect(workspacePageHref("w1")).toBe("/platform/workspaces/w1");
    expect(supportRequestHref("r1")).toBe("/platform/disputes/requests/r1");
  });

  it("keeps every /platform path outside the rail", () => {
    for (const path of ["/platform/workspaces", "/platform/workspaces/w1", "/platform/disputes/requests/r1"]) {
      expect(matchV2Route(path)).toMatchObject({ kind: "platform" });
      expect(navIdForPath(path)).toBeNull();
    }
    expect(breadcrumbFor("/platform/workspaces/w1", "Harbor Co").map((crumb) => crumb.label)).toEqual([
      "PLATFORM",
      "WORKSPACES",
      "WORKSPACE",
    ]);
    expect(breadcrumbFor("/platform/disputes/requests/r1", "Harbor Co").map((crumb) => crumb.label)).toEqual([
      "PLATFORM",
      "DISPUTES & SUPPORT",
      "SUPPORT REQUEST",
    ]);
  });

  it("registers the routes and keeps the legacy redirect", () => {
    const app = read("client/src/v2/V2AuthenticatedApp.tsx");
    expect(app).toContain('<Route path="/platform/:rest*" component={V2PlatformPage}');
    expect(app).toContain("V2LegacyAdminRedirect");
  });
});

describe("the Workspace register", () => {
  const register = (overrides: Partial<Parameters<typeof composeWorkspaceRegister>[0]> = {}) =>
    composeWorkspaceRegister({ rows, query: "", status: "all", plan: "all", now, ...overrides });

  it("filters on each state", () => {
    for (const status of statuses) {
      expect(register({ status }).rows.map((r) => r.id)).toEqual([status]);
    }
    expect(register().count).toBe(6);
    expect(register().countLabel).toBe("6 WORKSPACES");
  });

  it("searches the Workspace name and the Owner name and email", () => {
    const people = [
      row({ id: "a", name: "Harbor Co", owner: { userId: "1", name: "Ann Lee", email: "ann@harbor.test" } }),
      row({ id: "b", name: "Quay Ltd", owner: { userId: "2", name: "Bob Ray", email: "bob@quay.test" } }),
    ];
    const find = (query: string) => composeWorkspaceRegister({ rows: people, query, status: "all", plan: "all", now }).rows.map((r) => r.id);
    expect(find("harbor")).toEqual(["a", "b"].slice(0, 1));
    expect(find("bob ray")).toEqual(["b"]);
    expect(find("ann@harbor")).toEqual(["a"]);
  });

  it("filters on Plan, lists the Plans present, and searches the Plan label", () => {
    const plans = [
      row({ id: "a", name: "Alpha", planKey: "business", planLabel: "Business" }),
      row({ id: "b", name: "Beta", planKey: "team", planLabel: "Team" }),
      row({ id: "c", name: "Gamma", planKey: "business", planLabel: "Business" }),
    ];
    expect(planFilterOptions(plans)).toEqual([
      { value: "all", label: "All Plans" },
      { value: "business", label: "Business" },
      { value: "team", label: "Team" },
    ]);
    const find = (overrides: Partial<Parameters<typeof composeWorkspaceRegister>[0]>) =>
      composeWorkspaceRegister({ rows: plans, query: "", status: "all", plan: "all", now, ...overrides }).rows.map((r) => r.id);
    expect(find({ plan: "business" })).toEqual(["a", "c"]);
    expect(find({ plan: "team" })).toEqual(["b"]);
    expect(find({ query: "team" })).toEqual(["b"]);
    expect(find({ plan: "team", query: "alpha" })).toEqual([]);
  });

  it("labels the states and tells no match from none yet", () => {
    expect(register().rows.map((r) => r.planState)).toEqual([
      "Business · Trial",
      "Business · Offered Plan",
      "Business · Active",
      "Business · Past due",
      "Business · Read-only",
      "Business · Cancelled",
    ]);
    expect(register({ query: "zzz" }).emptyCopy).toBe("No Workspace matches this filter.");
    expect(composeWorkspaceRegister({ rows: [], query: "", status: "all", plan: "all", now }).emptyCopy).toBe(
      "No Workspaces on the platform yet.",
    );
  });

  it("shows seats used over purchased, and marks a cancelling Subscription", () => {
    const [cancelling] = composeWorkspaceRegister({
      rows: [row({ id: "c", cancelAtPeriodEnd: true })],
      query: "",
      status: "all",
      plan: "all",
      now,
    }).rows;
    expect(cancelling.seats).toBe("3 / 5");
    expect(cancelling.members).toBe("4 members");
    expect(cancelling.ends).toContain("cancels");
    expect(register().columns).toEqual(["WORKSPACE", "PLAN · STATE", "SEATS", "ENDS", "CREATED", "LAST ACTIVITY"]);
  });

  it("lists Subscriptions with a link to the Workspace", () => {
    const model = composeSubscriptions([row({ id: "s" })]);
    expect(model.rows[0]).toMatchObject({ href: "/platform/workspaces/s", interval: "Monthly", seats: "3 / 5", state: "Active" });
  });
});

describe("the Workspace page", () => {
  function detail(flags: Partial<PlatformWorkspaceDetail["subscription"]>): PlatformWorkspaceDetail {
    return {
      ...row({ id: "w1", name: "Harbor Co", periodEndsAt: "2026-11-01T00:00:00.000Z" }),
      subscription: {
        unitAmountMinor: 1200,
        currency: "eur",
        stripeCustomerUrl: "https://dashboard.stripe.com/customers/cus_1",
        stripeSubscriptionUrl: null,
        canExtendTrial: false,
        canOfferPlan: false,
        canCancel: false,
        canUndoCancel: false,
        ...flags,
      },
      payments: [
        { id: "p1", providerInvoiceId: "in_1", outcome: "failed", amountMinor: 1200, currency: "eur", occurredAt: "2026-10-01T00:00:00.000Z", stripeUrl: null },
      ],
      disputes: [],
      supportRequests: [],
      members: [{ userId: "u1", name: "Olive Owner", email: "olive@example.com", workspaceRole: "OWNER", archived: false }],
      auditEvents: [],
      offerablePlans: [{ planKey: "business", label: "Business" }],
    };
  }
  const kinds = (flags: Partial<PlatformWorkspaceDetail["subscription"]>) =>
    composeWorkspacePage(detail(flags), now).subscription.actions.map((a) => a.kind);

  it("offers only the actions its flags allow", () => {
    expect(kinds({})).toEqual([]);
    expect(kinds({ canExtendTrial: true, canOfferPlan: true })).toEqual(["extend-trial", "offer-plan"]);
    expect(kinds({ canCancel: true })).toEqual(["cancel"]);
    expect(kinds({ canUndoCancel: true })).toEqual(["undo-cancel"]);
  });

  it("states the consequence of each action", () => {
    const actions = composeWorkspacePage(
      detail({ canExtendTrial: true, canOfferPlan: true, canCancel: true }),
      now,
    ).subscription.actions;
    const offer = actions.find((a) => a.kind === "offer-plan")!;
    expect(offer.consequence).toContain("ends like a Trial");
    expect(offer.consequence).toContain("Read-only");
    expect(offer.consequence).toContain("unless the Owner subscribes");
    expect(offer.plans).toEqual([{ value: "business", label: "Business" }]);
    expect(actions.find((a) => a.kind === "cancel")).toMatchObject({ destructive: true });
    expect(actions.find((a) => a.kind === "extend-trial")?.fields).toEqual(["days"]);
  });

  it("links Stripe, and sends refunds to the Stripe Dashboard", () => {
    const page = composeWorkspacePage(detail({}), now);
    expect(page.subscription.stripeLinks).toEqual([
      { label: "Stripe customer", href: "https://dashboard.stripe.com/customers/cus_1" },
    ]);
    expect(page.subscription.stripeNote).toBe("Refunds, invoices and payment methods are handled in the Stripe Dashboard.");
    expect(page.payments.rows[0]).toMatchObject({ outcome: "Failed", failed: true });
    expect(page.members.rows[0].role).toBe("Owner");
  });

  it("validates what the actions send", () => {
    expect(trialExtensionBody({ days: "14" })).toEqual({ ok: true, body: { days: 14 } });
    expect(trialExtensionBody({ days: "91" }).ok).toBe(false);
    expect(offeredPlanBody({ planKey: "business", days: "30", seats: "" })).toEqual({
      ok: true,
      body: { planKey: "business", days: 30 },
    });
    expect(offeredPlanBody({ planKey: "business", days: "30", seats: "5" })).toEqual({
      ok: true,
      body: { planKey: "business", days: 30, seats: 5 },
    });
    expect(offeredPlanBody({ planKey: "", days: "30", seats: "" }).ok).toBe(false);
    expect(offeredPlanBody({ planKey: "business", days: "366", seats: "" }).ok).toBe(false);
    expect(offeredPlanBody({ planKey: "business", days: "30", seats: "0" }).ok).toBe(false);
  });
});

describe("stats", () => {
  const stats: PlatformStats = {
    days: 30,
    from: "2026-09-05T00:00:00.000Z",
    to: "2026-10-05T00:00:00.000Z",
    growth: { newUsers: 5, newWorkspaces: 2, activeWorkspaces7d: 4, activeWorkspaces30d: 6 },
    revenue: {
      mrr: [
        { currency: "eur", amountMinor: 120000 },
        { currency: "usd", amountMinor: 50000 },
      ],
      trialsInProgress: 3,
      offeredPlansInProgress: 1,
      trialConversions: 2,
      cancellations: 1,
    },
    payments: {
      failedPayments: 2,
      readOnlyByReason: [
        { reason: "trial_expired", count: 3 },
        { reason: "offer_expired", count: 1 },
        { reason: "dunning_exhausted", count: 1 },
        { reason: "cancel_at_period_end", count: 1 },
        { reason: "provider_projection", count: 1 },
        { reason: "mystery", count: 1 },
      ],
      openDisputes: 1,
    },
    usage: { hoursTracked: 1234.56, activeDesktopAgents: 7, screenshotsCaptured: 90 },
  };
  const groups = composeStats(stats).groups;

  it("has the four groups", () => {
    expect(groups.map((g) => g.id)).toEqual(["growth", "revenue", "payments", "usage"]);
  });

  it("keeps one MRR line per currency and never sums them", () => {
    const mrr = groups[1].lists[0];
    expect(mrr.lines.map((line) => line.label)).toEqual(["EUR", "USD"]);
    expect(mrr.lines).toHaveLength(2);
    expect(mrr.lines[0].value).toBe(formatMoney(120000, "eur"));
    expect(mrr.lines.map((l) => l.value)).not.toContain(formatMoney(170000, "eur"));
    const empty = composeStats({ ...stats, revenue: { ...stats.revenue, mrr: [] } }).groups[1].lists[0];
    expect(empty.lines).toEqual([]);
    expect(empty.emptyCopy).toBe("No recurring revenue yet");
  });

  it("reads each Read-only reason in plain words", () => {
    expect(groups[2].lists[0].lines.map((line) => line.label)).toEqual([
      "Trial ended",
      "Offered Plan ended",
      "Payment retries ran out",
      "Cancelled at period end",
      "Subscription ended",
      "Unknown",
    ]);
  });

  it("shows hours with one decimal", () => {
    expect(groups[3].tiles[0]).toEqual({ label: "HOURS TRACKED", value: "1234.6" });
  });
});

describe("disputes and Support Requests", () => {
  const request = (overrides: Partial<PlatformSupportRequestDetail> & { id: string }): PlatformSupportRequestDetail => ({
    workspaceId: "w1",
    workspaceName: "Harbor Co",
    user: { userId: "u1", name: "Olive Owner", email: "olive@example.com" },
    category: "billing",
    message: "Why was I charged twice?",
    status: "open",
    assignedStaff: null,
    createdAt: "2026-10-04T10:00:00.000Z",
    updatedAt: "2026-10-04T10:00:00.000Z",
    entries: [],
    ...overrides,
  });

  it("filters Support Requests by status", () => {
    const all = [
      request({ id: "a", status: "open" }),
      request({ id: "b", status: "in_progress" }),
      request({ id: "c", status: "resolved" }),
    ];
    const ids = (status: "all" | "open" | "in_progress" | "resolved") =>
      composeSupportRequests(all, { status }, now).rows.map((r) => r.id);
    expect(ids("all")).toEqual(["a", "b", "c"]);
    expect(ids("open")).toEqual(["a"]);
    expect(ids("in_progress")).toEqual(["b"]);
    expect(ids("resolved")).toEqual(["c"]);
    expect(composeSupportRequests([], { status: "resolved" }, now).emptyCopy).toBe("No resolved Support Request.");
    expect(composeSupportRequests(all, { status: "all" }, now).rows[0]).toMatchObject({
      href: "/platform/disputes/requests/a",
      assignee: "Unassigned",
    });
  });

  it("tells an answer from an internal note", () => {
    const page = composeSupportRequest(
      request({
        id: "a",
        entries: [
          { id: "e1", kind: "answer", body: "Refunded.", staff: { id: "s", email: "staff@docuflow.test" }, createdAt: "2026-10-04T11:00:00.000Z", emailedAt: "2026-10-04T11:00:01.000Z" },
          { id: "e2", kind: "note", body: "Checked Stripe.", staff: null, createdAt: "2026-10-04T11:05:00.000Z", emailedAt: null },
        ],
      }),
      now,
    );
    expect(page.entries.map((e) => [e.kind, e.label])).toEqual([
      ["answer", "Answer"],
      ["note", "Internal note"],
    ]);
    expect(page.entries[0].detail).toContain("Emailed to olive@example.com");
    expect(page.entries[1].detail).toBe("Only Platform Staff see this note.");
    expect(page.composer.answerHint).toContain("emails it to Olive Owner");
    expect(validateSupportEntry("  ").ok).toBe(false);
    expect(validateSupportEntry("x".repeat(10001)).ok).toBe(false);
    expect(validateSupportEntry(" hi ")).toEqual({ ok: true, body: { body: "hi" } });
  });

  it("lists payment disputes per currency amount and says Stripe answers them", () => {
    const model = composeDisputes(
      [
        { id: "d1", workspaceId: "w1", workspaceName: "Harbor Co", amountMinor: 5000, currency: "eur", reason: "fraudulent", status: "needs_response", open: true, openedAt: "2026-10-01T00:00:00.000Z", stripeUrl: "https://dashboard.stripe.com/disputes/d1" },
      ],
    );
    expect(model.note).toContain("Stripe answers disputes");
    expect(model.rows[0]).toMatchObject({ amount: formatMoney(5000, "eur"), reason: "Fraudulent", status: "Needs response", open: true });
  });
});

describe("support access and the audit log", () => {
  it("lists my active grants", () => {
    const model = composeSupportAccess(
      [{ grantId: "g1", workspaceId: "w1", workspaceName: "Harbor Co", expiresAt: "2026-10-06T10:00:00.000Z", createdAt: "2026-10-05T10:00:00.000Z" }],
    );
    expect(model.rows[0]).toMatchObject({ id: "g1", workspaceId: "w1", workspace: "Harbor Co" });
    expect(composeSupportAccess([]).empty).toBe(true);
  });

  it("requires a written reason for break-glass and says what it does", () => {
    expect(validateBreakGlassReason("   ").ok).toBe(false);
    expect(validateBreakGlassReason(" Payment failed ")).toEqual({ ok: true, body: { reason: "Payment failed" } });
    expect(composeBreakGlass("Harbor Co").description).toContain("The Owner is told");
    expect(composeBreakGlass("Harbor Co").description).toContain("Audit Event");
  });

  it("builds the audit query from the filters it has", () => {
    expect(platformAuditEventsPath()).toBe("/api/platform/audit-events");
    expect(platformAuditEventsPath({ workspaceId: "w1", platformStaffId: "", action: " break_glass " })).toBe(
      "/api/platform/audit-events?workspaceId=w1&action=break_glass",
    );
    const log = composeAuditLog(
      [{ id: "e1", workspaceId: "w1", workspaceName: "Harbor Co", actorKind: "platform_staff", actorId: "s", actorLabel: "staff@docuflow.test", action: "operator.break_glass", resourceType: "workspace", resourceId: "w1", createdAt: "2026-10-04T10:00:00.000Z" }],
      {},
    );
    expect(log.rows[0]).toMatchObject({ actor: "staff@docuflow.test", action: "operator.break_glass", resource: "workspace · w1" });
    expect(composeAuditLog([], { action: "x" }).emptyCopy).toBe("No Audit Event matches these filters.");
  });

  it("lists a User's Workspaces with their Workspace Role", () => {
    const model = composeUserWorkspaces([{ workspaceId: "w1", workspaceName: "Harbor Co", workspaceRole: "ADMINISTRATOR", archived: false }]);
    expect(model.rows[0]).toMatchObject({ name: "Harbor Co", role: "Administrator", href: "/platform/workspaces/w1" });
    expect(composeUserWorkspaces([]).empty).toBe(true);
  });
});

describe("money", () => {
  it("formats minor units in their own currency", () => {
    expect(formatMoney(null, "eur")).toBe("—");
    expect(formatMoney(1050, "usd")).toMatch(/10[.,]50/);
    expect(formatMoney(1050, "eur")).not.toBe(formatMoney(1050, "usd"));
  });
});

describe("Contact support on the Help page", () => {
  it("offers four categories", () => {
    expect(supportRequestCategories.map((c) => c.label)).toEqual(["Billing", "Bug", "Account", "Other"]);
  });

  it("accepts 1 to 5000 characters and a known category", () => {
    expect(validateSupportRequest({ category: "bug", message: "  It broke " })).toEqual({
      ok: true,
      body: { category: "bug", message: "It broke" },
    });
    expect(validateSupportRequest({ category: "bug", message: "   " }).ok).toBe(false);
    expect(validateSupportRequest({ category: "bug", message: "x".repeat(5000) }).ok).toBe(true);
    expect(validateSupportRequest({ category: "bug", message: "x".repeat(5001) }).ok).toBe(false);
    expect(validateSupportRequest({ category: "nope", message: "hi" }).ok).toBe(false);
  });

  it("is a shadcn form that posts to the support route", () => {
    const help = read("client/src/v2/V2Help.tsx");
    expect(help).toContain("SUPPORT_REQUESTS_PATH");
    expect(help).toContain("@/components/ui/textarea");
    expect(read("client/src/v2/help.ts")).toContain('"/api/support-requests"');
  });
});

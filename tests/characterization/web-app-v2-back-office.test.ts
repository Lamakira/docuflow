import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  backOfficeTabs,
  composeAuditLog,
  composePlatformFrame,
  composeBreakGlass,
  composeDisputes,
  composeStats,
  composeStatsCharts,
  distributionByPlan,
  formatCount,
  formatHours,
  distributionByStatus,
  platformStatsSeriesPath,
  shortDateLabel,
  queryRefusalCopy,
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
  type PlatformStatsSeries,
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

  it("routes every console path, deep links included, to the console and not the Workspace shell", async () => {
    // wouter matches with regexparam, where `:rest*` takes one segment only, so
    // a Workspace or Support Request page fell through to the Workspace shell.
    const { parse } = await import("regexparam");
    const app = read("client/src/v2/V2AuthenticatedApp.tsx");
    const patterns = [...app.matchAll(/<Route path="([^"]+)" component=\{V2PlatformPage\}/g)].map(
      (match) => parse(match[1]).pattern,
    );
    expect(patterns.length).toBeGreaterThan(0);
    for (const path of [
      "/platform",
      "/platform/stats",
      workspacePageHref("w1"),
      supportRequestHref("r1"),
    ]) {
      expect(patterns.some((pattern) => pattern.test(path)), path).toBe(true);
    }
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
    expect(groups[3].tiles[0]).toEqual({ label: "HOURS TRACKED", value: formatHours(1234.56) });
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

describe("the console is its own space (#314)", () => {
  it("composes the header, offering Open DocuFlow only with a Membership", () => {
    expect(composePlatformFrame({ email: "staff@docuflow.test", hasMembership: true })).toMatchObject({
      brand: "DocuFlow",
      title: "Platform console",
      email: "staff@docuflow.test",
      showOpenDocuFlow: true,
      openDocuFlowLabel: "Open DocuFlow",
      openDocuFlowHref: "/",
    });
    expect(composePlatformFrame({ email: null, hasMembership: false })).toMatchObject({
      email: "",
      showOpenDocuFlow: false,
    });
  });

  it("routes /platform outside TimeTrackerProvider and V2Shell", () => {
    const app = read("client/src/v2/V2AuthenticatedApp.tsx");
    const shell = app.indexOf("<V2Shell>");
    expect(app.indexOf('<Route path="/platform"')).toBeGreaterThan(-1);
    expect(app.indexOf('<Route path="/platform"')).toBeLessThan(app.indexOf("<TimeTrackerProvider>"));
    expect(app.indexOf('<Route path="/platform/:rest*"')).toBeLessThan(shell);
    expect(app.slice(shell)).not.toContain('path="/platform');
    expect(read("client/src/v2/V2Platform.tsx")).toContain("<V2PlatformFrame activeTab");
    expect(read("client/src/v2/V2Platform.tsx")).not.toContain("components/ui/tabs");
  });
});

describe("queryRefusalCopy", () => {
  it("reads a 403 Access denied as a refusal, not an empty list", () => {
    const copy = queryRefusalCopy(new Error("Access denied"));
    expect(copy).toBe("Only Platform Staff can see this.");
    expect(copy).not.toMatch(/Capability/);
    expect(copy).not.toMatch(/yet/);
  });

  it("reads a 401 without a session as a signed-out session", () => {
    expect(queryRefusalCopy(new Error("Unauthorized"))).toBe("Your session has ended. Sign in again.");
    expect(queryRefusalCopy(new Error("Not authenticated"))).toBe("Your session has ended. Sign in again.");
  });

  it("passes a second-factor refusal through in its own words", () => {
    expect(queryRefusalCopy(new Error("A second factor is required"))).toBe("A second factor is required");
  });

  it("falls back when the error carries no message", () => {
    expect(queryRefusalCopy(undefined)).toBe("This could not be loaded. Try again.");
  });
});

describe("the vertical rail (#314)", () => {
  it("builds the rail on the shadcn Sidebar, six items, account in the footer", () => {
    const frame = read("client/src/v2/V2PlatformFrame.tsx");
    expect(frame).toContain('collapsible="icon"');
    expect(frame).toContain("SidebarFooter");
    expect(frame).toContain("SidebarTrigger");
    expect(frame).toContain("localStorage");
    expect(frame).not.toContain("df-platform-header");
    for (const icon of ["Building2", "Users", "CreditCard", "LifeBuoy", "BarChart3", "KeyRound"]) {
      expect(frame).toContain(icon);
    }
  });

  it("offers the theme as a segmented toggle that keeps the menu open, in both account menus", () => {
    const toggle = read("client/src/v2/V2ThemeToggle.tsx");
    expect(toggle).toContain("df-theme-toggle");
    for (const icon of ["Sun", "Moon", "Monitor"]) expect(toggle).toContain(icon);
    // A prevented select skips Radix's own onValueChange, so the item sets the theme itself.
    expect(toggle).toMatch(/event\.preventDefault\(\);\s*setTheme\(option\.id\);/);
    for (const menu of ["client/src/v2/V2PlatformFrame.tsx", "client/src/v2/V2Rail.tsx"]) {
      const source = read(menu);
      expect(source).toContain("<V2ThemeToggle");
      expect(source).not.toContain("DropdownMenuRadioItem");
    }
  });
});

const point = (date: string, over: Partial<PlatformStatsSeries["points"][number]> = {}) => ({
  date,
  newUsers: 0,
  newWorkspaces: 0,
  activeWorkspaces: 0,
  paidPayments: 0,
  failedPayments: 0,
  ...over,
});

const statsFixture = (mrr: PlatformStats["revenue"]["mrr"], readOnlyByReason: PlatformStats["payments"]["readOnlyByReason"] = []): PlatformStats => ({
  days: 7,
  from: "2026-09-30",
  to: "2026-10-06",
  growth: { newUsers: 0, newWorkspaces: 0, activeWorkspaces7d: 0, activeWorkspaces30d: 0 },
  revenue: { mrr, trialsInProgress: 0, offeredPlansInProgress: 0, trialConversions: 0, cancellations: 0 },
  payments: { failedPayments: 0, readOnlyByReason, openDisputes: 0 },
  usage: { hoursTracked: 0, activeDesktopAgents: 0, screenshotsCaptured: 0 },
});

describe("stats charts (#314)", () => {
  it("has the series path and a short date label", () => {
    expect(platformStatsSeriesPath(30)).toBe("/api/platform/stats/series?days=30");
    expect(shortDateLabel("2026-10-06")).toBe("6 Oct");
    expect(shortDateLabel("2026-01-31")).toBe("31 Jan");
  });

  it("maps the series in a fixed order and flags empty series", () => {
    const series: PlatformStatsSeries = {
      days: 7,
      from: "2026-10-05",
      to: "2026-10-06",
      points: [point("2026-10-05", { newUsers: 2, activeWorkspaces: 1 }), point("2026-10-06", { newUsers: 1 })],
    };
    const charts = composeStatsCharts(statsFixture([]), series, []);
    expect(charts.growth?.series.map((item) => [item.key, item.label, item.empty])).toEqual([
      ["newWorkspaces", "New Workspaces", true],
      ["newUsers", "New Users", false],
    ]);
    expect(charts.growth?.series[0].emptyCopy).toBe("No new Workspaces in this period.");
    expect(charts.growth?.empty).toBe(false);
    expect(charts.growth?.points.map((item) => [item.label, item.newWorkspaces, item.newUsers])).toEqual([
      ["5 Oct", 0, 2],
      ["6 Oct", 0, 1],
    ]);
    expect(charts.activeWorkspaces?.empty).toBe(false);
    expect(charts.activeWorkspaces?.caption).toBe(
      "Counts Workspaces with a Time Entry that day. Sign-ins are not stored per day.",
    );
    const zero = composeStatsCharts(null, { days: 7, from: "a", to: "b", points: [point("2026-10-06")] }, null);
    expect(zero.growth?.empty).toBe(true);
    expect(zero.payments?.empty).toBe(true);
    expect(composeStatsCharts(null, null, null).growth).toBeNull();
    // A server without the series route answers with HTML, which apiRequest hands back as a Response.
    const notSeries = {} as unknown as Parameters<typeof composeStatsCharts>[1];
    expect(() => composeStatsCharts(null, notSeries, null)).not.toThrow();
  });

  it("totals payments for the period", () => {
    const series: PlatformStatsSeries = {
      days: 7,
      from: "a",
      to: "b",
      points: [point("2026-10-05", { paidPayments: 3, failedPayments: 1 }), point("2026-10-06", { paidPayments: 2 })],
    };
    const payments = composeStatsCharts(null, series, null).payments;
    expect(payments?.totals).toEqual({ paid: 5, failed: 1 });
    expect(payments?.totalsLabel).toBe("5 paid · 1 failed in this period");
    expect(payments?.points[0]).toMatchObject({ label: "5 Oct", paid: 3, failed: 1 });
  });

  it("gives one MRR tile per currency and never sums them", () => {
    const charts = composeStatsCharts(
      statsFixture([
        { currency: "eur", amountMinor: 10000 },
        { currency: "usd", amountMinor: 5000 },
      ]),
      null,
      null,
    );
    expect(charts.mrr.map((tile) => tile.label)).toEqual(["MRR · EUR", "MRR · USD"]);
    expect(charts.mrr[0].value).toBe(formatMoney(10000, "eur"));
    expect(charts.mrr[1].value).toBe(formatMoney(5000, "usd"));
    expect(charts.mrr).toHaveLength(2);
  });

  it("counts Workspaces by state and by Plan, largest first", () => {
    const data = [
      row({ id: "1", status: "active", planKey: "pro", planLabel: "Pro" }),
      row({ id: "2", status: "active", planKey: "pro", planLabel: "Pro" }),
      row({ id: "3", status: "trial", planKey: "team", planLabel: "Team" }),
      row({ id: "4", status: "active", planKey: "team", planLabel: "Team" }),
      row({ id: "5", status: "cancelled", planKey: "pro", planLabel: "Pro" }),
    ];
    expect(distributionByStatus(data)).toEqual([
      { key: "active", label: "Active", count: 3 },
      { key: "trial", label: "Trial", count: 1 },
      { key: "cancelled", label: "Cancelled", count: 1 },
    ]);
    expect(distributionByPlan(data).map((entry) => [entry.label, entry.count])).toEqual([
      ["Pro", 3],
      ["Team", 2],
    ]);
  });

  it("reads Read-only by reason from the stats, sorted, with the reason labels", () => {
    const charts = composeStatsCharts(
      statsFixture([], [
        { reason: "trial_expired", count: 1 },
        { reason: "dunning_exhausted", count: 4 },
      ]),
      null,
      [],
    );
    const reason = charts.distributions.find((item) => item.id === "reason");
    expect(reason?.entries?.map((entry) => [entry.label, entry.count])).toEqual([
      ["Payment retries ran out", 4],
      ["Trial ended", 1],
    ]);
    expect(charts.distributions.find((item) => item.id === "status")?.empty).toBe(true);
  });

  it("groups counts and hours, with at most one decimal", () => {
    const group = (value: number, digits: number) =>
      new Intl.NumberFormat(undefined, { maximumFractionDigits: digits }).format(value);
    expect(formatCount(5820)).toBe(group(5820, 0));
    expect(formatCount(5820)).not.toBe("5820.0");
    expect(formatHours(1243.54)).toBe(group(1243.54, 1));
    expect(formatCount(7)).toBe("7");
  });

  it("draws linear lines and a container-query grid", () => {
    expect(read("client/src/v2/V2BackOfficeCharts.tsx")).toContain('type="linear"');
    expect(read("client/src/v2/V2BackOfficeCharts.tsx")).not.toContain('type="monotone"');
    expect(read("client/src/v2/tokens.css")).toContain("@container (min-width: 1100px)");
  });
});

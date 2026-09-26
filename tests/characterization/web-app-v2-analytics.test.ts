import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ADMINISTRATION_TAB_IDS,
  administrationTabHref,
  administrationTabs,
  breadcrumbFor,
  matchV2Route,
  navIdForPath,
} from "../../client/src/v2/presentation";
import {
  analyticsRange,
  composeAdministration,
  composeAnalytics,
  type AdministrationInput,
  type AnalyticsInput,
  type AnalyticsProductivityInput,
} from "../../client/src/v2/administration";

/**
 * Analytics on its own rail entry, a readable Recorded time, and Administration
 * in tabs (#281). Seams: matchV2Route and the tab helpers in presentation.ts,
 * and the pure composers over `/api/admin/*`. HTTP stays characterized in
 * admin-analytics.test.ts. Do not assert hex.
 */

const here = dirname(fileURLToPath(import.meta.url));
const read = (path: string) => readFileSync(join(here, path), "utf8");
const appSource = read("../../client/src/v2/V2AuthenticatedApp.tsx");
const adminSource = read("../../client/src/v2/V2Administration.tsx");
const analyticsSource = read("../../client/src/v2/V2Analytics.tsx");
const railIcons = read("../../client/src/v2/icons.tsx");
const css = read("../../client/src/v2/tokens.css").replace(/\/\*[\s\S]*?\*\//g, "");

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
  return match?.[1] ?? "";
}

const NOW = new Date("2026-09-14T12:00:00.000Z");
const RANGE = analyticsRange("7d", NOW);

function analyticsInput(overrides: Partial<AnalyticsInput> = {}): AnalyticsInput {
  return {
    now: NOW,
    workspaceName: "Harbor Co",
    workspaceRole: "OWNER",
    ownerName: "Sam Lee",
    range: RANGE,
    overview: null,
    activity: null,
    coverage: null,
    devices: [],
    ...overrides,
  };
}

const PRODUCTIVITY: AnalyticsProductivityInput = {
  byUser: [
    { userId: "u-1", userName: "Ada Byron", totalSeconds: 36000, idleSeconds: 3600, entriesCount: 4 },
    { userId: "u-2", userName: "Grace Hopper", totalSeconds: 7200, idleSeconds: 0, entriesCount: 1 },
  ],
  byProject: [{ crmProjectId: "prj-1", projectName: "Harbor", totalSeconds: 43200, entriesCount: 5 }],
  byTask: [{ taskId: "task-1", taskName: "Survey", totalSeconds: 7200 }],
  dailyTrend: [
    { date: "2026-09-10", totalSeconds: 36000 },
    { date: "2026-09-11", totalSeconds: 7200 },
  ],
};

function adminInput(overrides: Partial<AdministrationInput> = {}): AdministrationInput {
  return {
    workspaceName: "Harbor Co",
    ownerName: "Sam Lee",
    workspaceRole: "OWNER",
    condition: null,
    serviceAccounts: [],
    webhookEndpoints: [],
    billing: null,
    revealedSecret: null,
    ...overrides,
  };
}

describe("Analytics is its own destination on the rail (#281)", () => {
  it("resolves /analytics to a live destination with its own crumb and rail entry", () => {
    expect(matchV2Route("/analytics")).toEqual({ kind: "analytics", title: "Analytics", href: "/analytics" });
    expect(navIdForPath("/analytics")).toBe("analytics");
    expect(breadcrumbFor("/analytics", "Harbor Co").map((crumb) => crumb.label)).toEqual([
      "HARBOR CO",
      "ANALYTICS",
    ]);
    expect(appSource).toMatch(/<Route path="\/analytics" component=\{V2AnalyticsPage\} \/>/);
    expect(railIcons).toMatch(/analytics:\s*\w+/);
  });

  it("redirects the old addresses there", () => {
    // v1's page, which used to land on Administration's warnings.
    expect(matchV2Route("/admin/analytics").kind).toBe("analytics");
    expect(appSource).toMatch(/path="\/admin\/analytics">\s*<Redirect to="\/analytics" \/>/);
    expect(appSource).not.toContain("/administration#alerts");
    // A saved /administration#alerts is carried to the same card on Analytics.
    expect(adminSource).toContain('window.location.hash === "#alerts"');
    expect(adminSource).toContain('navigate("/analytics#alerts", { replace: true })');
    expect(analyticsSource).toContain('id="alerts"');
    expect(analyticsSource).toContain("scrollIntoView");
  });

  it("holds the analytics panes and the four #259 dashboards, and Administration no longer does", () => {
    for (const testId of [
      "v2-analytics-overview",
      "v2-analytics-alerts",
      "v2-analytics-evidence-quality",
      "v2-analytics-recorded-time",
      "v2-analytics-screenshots",
      "v2-analytics-activity",
      "v2-analytics-coverage",
      "v2-analytics-devices",
    ]) {
      expect(analyticsSource).toContain(testId);
    }
    expect(adminSource).not.toMatch(/composeAnalytics|analyticsOverviewPath|analyticsProductivityPath/);
    expect(adminSource).not.toContain("AdministrationAnalytics");
  });

  it("reads behind the same gate and names Analytics when it refuses", () => {
    expect(analyticsSource).toContain("enabled: canManage");
    const member = composeAnalytics(analyticsInput({ workspaceRole: "MEMBER" }));
    expect(member.kind).toBe("refusal");
    if (member.kind !== "refusal") return;
    expect(member.refusal).toBe(
      "Analytics is open to the Owner and Administrators. Your Workspace Role is Member. Sam Lee (Owner) can change it.",
    );
  });
});

describe("Recorded time can be read by someone seeing it for the first time (#281)", () => {
  it("says what it measures, over which range, and for whom", () => {
    const page = composeAnalytics(analyticsInput({ productivity: PRODUCTIVITY }));
    expect(page.kind).toBe("ready");
    if (page.kind !== "ready") return;
    expect(page.recordedTime.measures).toBe(
      "Time Entries that started between 7 SEP and 14 SEP, for every Member of Harbor Co. " +
        "A running Timer counts once it stops.",
    );
  });

  it("reads its totals as a sentence, and puts the same figures beside it", () => {
    const page = composeAnalytics(analyticsInput({ productivity: PRODUCTIVITY }));
    expect(page.kind).toBe("ready");
    if (page.kind !== "ready") return;
    expect(page.recordedTime.sentence).toBe(
      "2 Members recorded 12.0 h on 5 Time Entries across 1 Project. 1.0 h of it was idle.",
    );
    expect(page.recordedTime.summary).toEqual([
      { label: "RECORDED", value: "12.0 h" },
      { label: "OF WHICH IDLE", value: "1.0 h" },
      { label: "TIME ENTRIES", value: "5" },
      { label: "MEMBERS", value: "2" },
    ]);
  });

  it("speaks in the singular when there is one of a thing, and says when nothing was idle", () => {
    const page = composeAnalytics(
      analyticsInput({
        productivity: {
          byUser: [{ userId: "u-2", userName: "Grace Hopper", totalSeconds: 7200, idleSeconds: 0, entriesCount: 1 }],
          byProject: [{ crmProjectId: "prj-1", projectName: "Harbor", totalSeconds: 7200, entriesCount: 1 }],
          byTask: [],
          dailyTrend: [{ date: "2026-09-11", totalSeconds: 7200 }],
        },
      }),
    );
    expect(page.kind).toBe("ready");
    if (page.kind !== "ready") return;
    expect(page.recordedTime.sentence).toBe(
      "1 Member recorded 2.0 h on 1 Time Entry across 1 Project. None of it was idle.",
    );
  });

  it("names whose or where the hours are before each breakdown's rows", () => {
    const page = composeAnalytics(analyticsInput({ productivity: PRODUCTIVITY }));
    expect(page.kind).toBe("ready");
    if (page.kind !== "ready") return;
    const { sections } = page.recordedTime;
    expect([sections.members, sections.projects, sections.tasks, sections.days].map((section) => section.label)).toEqual([
      "PER MEMBER",
      "PER PROJECT",
      "PER TASK",
      "PER DAY",
    ]);
    expect(sections.members.head).toEqual(["MEMBER", "RECORDED", "OF WHICH IDLE", "TIME ENTRIES"]);
    expect(sections.tasks.caption).toBe(
      "Time Entries linked to a Task. Time without a Task is left out of this list.",
    );
    for (const section of Object.values(sections)) {
      expect(section.caption.endsWith(".")).toBe(true);
    }
    expect(page.recordedTime.days.map((row) => row.day)).toEqual(["THU 10 SEP", "FRI 11 SEP"]);
    expect(analyticsSource).toContain("df-analytics-group-caption");
    expect(analyticsSource).toContain('data-testid="v2-analytics-recorded-time-sentence"');
  });

  it("keeps its empty and error states", () => {
    const empty = composeAnalytics(analyticsInput());
    expect(empty.kind).toBe("ready");
    if (empty.kind !== "ready") return;
    expect(empty.recordedTime.empty).toBe(true);
    expect(empty.recordedTime.emptyCopy).toBe("No tracked time in this range.");
    expect(empty.recordedTime.sentence).toBeNull();
    expect(empty.recordedTime.summary).toEqual([]);
    expect(analyticsSource).toContain(
      "Recorded time could not be read for this range. Nothing here is a count of zero.",
    );
  });

  it("styles the sentence and captions on the scale and in tokens", () => {
    expect(rule(".df-recorded-sentence")).toMatch(/color:\s*var\(--df-case-ink\)/);
    expect(rule(".df-recorded-sentence")).toMatch(/padding:\s*var\(--df-space-4\) var\(--df-space-4\) 0/);
    expect(rule(".df-analytics-group-caption")).toMatch(/color:\s*var\(--df-archive-slate\)/);
    expect(rule(".df-analytics-group-caption")).not.toMatch(/#[0-9a-f]{3,6}\b/i);
  });
});

describe("Administration shows one configuration section at a time (#281)", () => {
  it("keeps the tab in the path, with Workspace as the destination itself", () => {
    expect(ADMINISTRATION_TAB_IDS).toEqual([
      "workspace",
      "billing",
      "members",
      "tracking-policy",
      "crm-fields",
      "integrations",
      "danger-zone",
    ]);
    expect(administrationTabHref("workspace")).toBe("/administration");
    expect(administrationTabHref("billing")).toBe("/administration/billing");
    expect(administrationTabHref("danger-zone")).toBe("/administration/danger-zone");
    expect(appSource).toMatch(/path="\/administration\/:tab\?"/);
  });

  it("resolves a deep link to the section it names, and keeps /administration and /admin working", () => {
    expect(matchV2Route("/administration")).toMatchObject({ kind: "administration", tab: "workspace", href: "/administration" });
    expect(matchV2Route("/administration/integrations")).toMatchObject({
      kind: "administration",
      tab: "integrations",
      href: "/administration/integrations",
    });
    expect(matchV2Route("/admin")).toMatchObject({ kind: "administration", tab: "workspace" });
    expect(navIdForPath("/administration/billing")).toBe("administration");
    expect(breadcrumbFor("/administration/tracking-policy", "Harbor Co")).toEqual([
      { label: "HARBOR CO", href: "/" },
      { label: "ADMINISTRATION", href: "/administration" },
      { label: "TRACKING POLICY" },
    ]);
    // A tab that does not exist lands on Workspace rather than an empty page.
    expect(adminSource).toContain('navigate(administrationTabHref("workspace"), { replace: true })');
  });

  it("offers every tab to the Owner and Administrators, and none to a Member", () => {
    const owner = administrationTabs("billing", "OWNER");
    expect(owner.map((tab) => tab.label)).toEqual([
      "Workspace",
      "Billing",
      "Members & Roles",
      "Tracking Policy",
      "CRM fields",
      "Integrations",
      "Danger zone",
    ]);
    expect(owner.filter((tab) => tab.active).map((tab) => tab.id)).toEqual(["billing"]);
    expect(administrationTabs("workspace", "ADMINISTRATOR")).toHaveLength(7);
    expect(administrationTabs("workspace", "MEMBER")).toEqual([]);
  });

  it("draws the tabs with the shadcn Tabs, one panel per section", () => {
    expect(adminSource).toContain('from "@/components/ui/tabs"');
    expect(adminSource).toContain("<TabsList");
    expect(adminSource).toContain("<TabsTrigger");
    // Arrowing across the strip moves focus, not history.
    expect(adminSource).toContain('activationMode="manual"');
    for (const id of ADMINISTRATION_TAB_IDS) {
      expect(adminSource).toContain(`<TabsContent value="${id}"`);
    }
    // Each section sits in the panel the grouping names.
    const panel = (id: string) => {
      const start = adminSource.indexOf(`<TabsContent value="${id}"`);
      return adminSource.slice(start, adminSource.indexOf("</TabsContent>", start));
    };
    expect(panel("billing")).toContain('data-testid="v2-administration-billing"');
    expect(panel("crm-fields")).toContain('data-testid="v2-administration-crm-modules"');
    expect(panel("integrations")).toContain('data-testid="v2-administration-service-accounts"');
    expect(panel("integrations")).toContain('data-testid="v2-administration-webhooks"');
    expect(panel("integrations")).toContain('data-testid="v2-administration-secret"');
    expect(panel("tracking-policy")).toContain('data-testid="v2-administration-tracking-policy"');
    expect(panel("tracking-policy")).toContain('data-testid="v2-administration-timezones"');
    expect(panel("danger-zone")).toContain("<CancelControl");
    expect(panel("billing")).not.toContain("<CancelControl");
  });

  it("starts every tab's content one page gap below the strip", () => {
    // Radix keeps inactive panels mounted as empty `[hidden]` divs. A panel's
    // own display outranks the UA rule, so without this each hidden panel ahead
    // of the active one added a gap and the space grew with the tab's position.
    expect(rule(".df-v2 .df-admin-panel")).toMatch(/display:\s*flex/);
    expect(rule(".df-v2 .df-admin-panel[hidden]")).toMatch(/display:\s*none/);
    // Same distance as Time and Activity, whose strip sits in the page column.
    expect(rule(".df-admin-tabs")).toMatch(/gap:\s*var\(--df-space-5\)/);
    expect(rule(".df-page")).toMatch(/gap:\s*var\(--df-space-5\)/);
    expect(rule(".df-v2 .df-admin-panel")).toMatch(/margin:\s*0/);
    expect(adminSource).not.toContain("forceMount");
  });

  it("returns a Stripe customer to the Billing tab", () => {
    expect(adminSource).toContain('administrationTabHref("billing")');
  });

  it("wears the v2 tab strip over shadcn's pill, in tokens that hold in the dark palette", () => {
    const active = rule('.df-v2 .df-tab[data-state="active"]');
    expect(active).toMatch(/border-bottom-color:\s*var\(--df-amber-500\)/);
    expect(active).toMatch(/color:\s*var\(--df-case-ink\)/);
    expect(rule('.df-v2 .df-tabs[role="tablist"]')).toMatch(/background:\s*transparent/);
    expect(rule('.df-v2 .df-tab[role="tab"]')).toMatch(/padding:\s*var\(--df-space-2\) var\(--df-space-3\)/);
    expect(rule(".df-v2 .df-admin-panel")).toMatch(/gap:\s*var\(--df-space-5\)/);
    expect(rule(".df-danger-zone")).toMatch(/border-color:\s*var\(--df-alert-line\)/);
    for (const selector of [
      '.df-v2 .df-tabs[role="tablist"]',
      '.df-v2 .df-tab[role="tab"]',
      '.df-v2 .df-tab[data-state="active"]',
      ".df-danger-row",
    ]) {
      expect(rule(selector)).not.toMatch(/#[0-9a-f]{3,6}\b/i);
    }
  });
});

describe("The Workspace, Members & Roles and Danger zone tabs (#281)", () => {
  it("states who owns the Workspace and the Role the reader holds", () => {
    const page = composeAdministration(
      adminInput({
        workspaceRole: "ADMINISTRATOR",
        members: [
          { firstName: "Sam", lastName: "Lee", email: "sam@harbor.test", workspaceRole: "OWNER" },
          { firstName: "Ada", lastName: "Byron", email: "ada@harbor.test", workspaceRole: "ADMINISTRATOR" },
        ],
      }),
    );
    expect(page.kind).toBe("ready");
    if (page.kind !== "ready") return;
    expect(page.workspace.figures).toEqual([
      { label: "WORKSPACE", value: "Harbor Co" },
      { label: "OWNER", value: "Sam Lee" },
      { label: "YOUR WORKSPACE ROLE", value: "Administrator" },
      { label: "MEMBERS", value: "2" },
    ]);
  });

  it("lists each Member's Workspace Role and sends a change to People", () => {
    const page = composeAdministration(
      adminInput({
        members: [{ firstName: null, lastName: null, email: "kit@harbor.test", workspaceRole: "MEMBER" }],
      }),
    );
    expect(page.kind).toBe("ready");
    if (page.kind !== "ready") return;
    expect(page.members.rows).toEqual([
      { id: "kit@harbor.test", name: "kit@harbor.test", email: "kit@harbor.test", workspaceRole: "Member" },
    ]);
    expect(page.members.note).toBe(
      "Analytics and Administration are open to the Owner and Administrators. A Workspace Role is changed in People.",
    );
    expect(adminSource).toContain('<Link href="/people"');
  });

  it("moves Cancel at period end to Danger zone and says so on Billing", () => {
    const page = composeAdministration(
      adminInput({
        billing: {
          planKey: "pro",
          billingState: "Active",
          purchasedSeatCapacity: 8,
          consumedSeatCount: 3,
          trialEndsAt: null,
          periodEndsAt: "2026-10-01T00:00:00.000Z",
          cancelAtPeriodEnd: false,
          stripeCustomerId: "cus_123",
        },
      }),
    );
    expect(page.kind).toBe("ready");
    if (page.kind !== "ready") return;
    expect(page.dangerZone.actions.map((action) => action.id)).toEqual(["cancel"]);
    expect(adminSource).toContain('action.tone !== "destructive"');
    expect(adminSource).toContain("Ending the Subscription is under");
  });

  it("says why Danger zone is empty rather than drawing a blank card", () => {
    const page = composeAdministration(adminInput());
    expect(page.kind).toBe("ready");
    if (page.kind !== "ready") return;
    expect(page.dangerZone.actions).toEqual([]);
    expect(page.dangerZone.emptyCopy).toContain("Cancel at period end is offered while a paid Subscription is active");
  });
});

describe("A destructive row action asks before it runs (#281)", () => {
  it("confirms deleting a CRM module or field and revoking a Service Account in an AlertDialog", () => {
    expect(adminSource).toContain("function DestructiveConfirm(");
    expect(adminSource).toMatch(/<DestructiveConfirm label="Delete" title=\{`Delete \$\{module\.name\}`\}/);
    expect(adminSource).toMatch(/<DestructiveConfirm label="Delete" title=\{`Delete \$\{field\.name\}`\}/);
    expect(adminSource).toMatch(/<DestructiveConfirm\s+label="Revoke"/);
    // No press mutates on its own.
    expect(adminSource).not.toMatch(/onClick=\{\(\) => \{ if \(!guardWrite\(\)\) return; delete(CrmModule|CrmField)\.mutate/);
    expect(adminSource).not.toMatch(/onClick=\{\(\) => onRevoke\(/);
    const confirm = adminSource.slice(adminSource.indexOf("function DestructiveConfirm("));
    expect(confirm).toContain("<AlertDialogCancel className=\"df-btn\" autoFocus>");
    expect(confirm).toContain('variant="destructiveOutline"');
  });
});

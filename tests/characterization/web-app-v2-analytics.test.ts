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
  ANALYTICS_FILTERS_DEFAULT,
  ANALYTICS_RANGE_PRESETS,
  analyticsDevicesPath,
  analyticsPath,
  analyticsRange,
  analyticsRangeWords,
  captureLine,
  composeCaptures,
  composeDevices,
  composeFigureBand,
  composeHourly,
  composeHoursChart,
  composeRecordedTime,
  composeWarnings,
  customFromRange,
  exportFilename,
  limitRows,
  memberActivityHref,
  memberTimeHref,
  readAnalyticsFilters,
  writeAnalyticsFilters,
  type AnalyticsAlertsInput,
  type AnalyticsCoverageInput,
  type AnalyticsProductivityInput,
} from "../../client/src/v2/analytics";
import { composeBilling, composeWorkspaceCard } from "../../client/src/v2/administration";

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
const adminBillingSource = read("../../client/src/v2/V2AdministrationBilling.tsx");
const adminWorkspaceSource = read("../../client/src/v2/V2AdministrationWorkspace.tsx");
/** The shell and its tabs, one file each since the Administration review (F107). */
const adminPagesSource = [
  adminSource,
  adminBillingSource,
  adminWorkspaceSource,
  read("../../client/src/v2/V2AdministrationTrackingPolicy.tsx"),
  read("../../client/src/v2/V2AdministrationPipelineLists.tsx"),
  read("../../client/src/v2/V2AdministrationIntegrations.tsx"),
  read("../../client/src/v2/V2DestructiveConfirm.tsx"),
].join("\n");
const analyticsSource = read("../../client/src/v2/V2Analytics.tsx");
const railIcons = read("../../client/src/v2/icons.tsx");
const css = read("../../client/src/v2/tokens.css").replace(/\/\*[\s\S]*?\*\//g, "");

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
  return match?.[1] ?? "";
}

const NOW = new Date(2026, 8, 14, 12, 0, 0);
const RANGE = analyticsRange("7d", NOW);
const chartsSource = read("../../client/src/v2/V2AnalyticsCharts.tsx");

const PRODUCTIVITY: AnalyticsProductivityInput = {
  byUser: [
    { userId: "u-1", userName: "Ada Byron", totalSeconds: 36000, idleSeconds: 3600, entriesCount: 4 },
    { userId: "u-2", userName: "Grace Hopper", totalSeconds: 7200, idleSeconds: 0, entriesCount: 1 },
    { userId: "u-3", userName: "Idle Ivan", totalSeconds: 0, idleSeconds: 600, entriesCount: 1 },
  ],
  byProject: [
    { crmProjectId: "prj-1", projectName: "Design", clientName: "Acme", totalSeconds: 28800, entriesCount: 3 },
    { crmProjectId: "prj-2", projectName: "Design", clientName: null, totalSeconds: 14400, entriesCount: 2 },
  ],
  byTask: [
    {
      taskId: "task-1",
      taskName: "Survey",
      crmProjectId: "prj-1",
      projectName: "Design",
      clientName: "Acme",
      totalSeconds: 7200,
    },
    { taskId: null, taskName: "Loose", crmProjectId: null, projectName: null, clientName: null, totalSeconds: 60 },
  ],
  dailyTrend: [
    { date: "2026-09-10", totalSeconds: 36000 },
    { date: "2026-09-11", totalSeconds: 7200 },
  ],
};

const COVERAGE: AnalyticsCoverageInput = {
  summary: {
    totalTrackedSeconds: 43200,
    totalScreenshots: 412,
    expectedScreenshots: 980,
    coveragePercent: 42,
    totalEntries: 5,
    entriesWithoutScreenshots: 2,
    lowCoverageEntries: 1,
    deletedScreenshots: 7,
    captureEveryMinutes: 5,
  },
  byUser: [
    {
      userId: "u-1",
      userName: "Ada Byron",
      trackedSeconds: 36000,
      entriesCount: 4,
      entriesWithoutScreenshots: 1,
      screenshotCount: 412,
      expectedScreenshots: 980,
      coveragePct: 42.04,
    },
    {
      userId: "u-2",
      userName: "Grace Hopper",
      trackedSeconds: 7200,
      entriesCount: 1,
      entriesWithoutScreenshots: 1,
      screenshotCount: 0,
      expectedScreenshots: 0,
      coveragePct: null,
    },
  ],
};

function workspaceInput(overrides: Partial<Parameters<typeof composeWorkspaceCard>[0]> = {}): Parameters<typeof composeWorkspaceCard>[0] {
  return {
    workspaceName: "Harbor Co",
    ownerName: "Sam Lee",
    workspaceRole: "Owner",
    ...overrides,
  };
}

describe("Analytics is its own destination on the rail (#281)", () => {
  it("resolves /analytics to a live destination with its own crumb and rail entry", () => {
    expect(matchV2Route("/analytics")).toEqual({ kind: "analytics", title: "Analytics", href: "/analytics" });
    expect(navIdForPath("/analytics")).toBe("analytics");
    expect(breadcrumbFor("/analytics", "Harbor Co").map((crumb) => crumb.label)).toEqual(["Harbor Co"]);
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

  it("holds the six cards of the page, and Administration no longer does", () => {
    for (const testId of [
      "v2-analytics-overview",
      "v2-analytics-alerts",
      "v2-analytics-hours",
      "v2-analytics-recorded-time",
      "v2-analytics-captures",
      "v2-analytics-devices",
    ]) {
      expect(analyticsSource).toContain(testId);
    }
    expect(adminPagesSource).not.toMatch(/composeAnalytics|analyticsOverviewPath|analyticsProductivityPath/);
    expect(adminPagesSource).not.toContain("AdministrationAnalytics");
  });

  it("reads behind the same gate and names Analytics when it refuses", () => {
    expect(analyticsSource).toContain("const canManage = known && canManageAdministration(workspaceRole)");
    expect(analyticsSource).toContain("    enabled,");
    expect(analyticsSource).toContain("analyticsRefusal({");
    // The refusal sits under the head, drawn by the shared state; no Range and no Export for someone refused.
    expect(analyticsSource).toContain('<V2EmptyState icon="access"');
    expect(analyticsSource).toContain("canManage && !refusal ? (");
    expect(analyticsSource).not.toContain("df-refusal");
  });

  it("draws the head at once, before any read, with the Range in words as its chip", () => {
    expect(analyticsSource).toContain('<V2PageHead title="Analytics" chip={refusal ? undefined : analyticsRangeWords(range, today)}');
    expect(analyticsSource).not.toContain("subhead=");
    expect(analyticsSource).not.toContain("AnalyticsSkeleton");
    expect(analyticsSource).toContain("useToday()");
  });
});

describe("Recorded time, in one card with tabs (#281, F99)", () => {
  it("counts Members, Projects and Tasks, and links each name to its record", () => {
    const recorded = composeRecordedTime(PRODUCTIVITY);
    expect(recorded.empty).toBe(false);
    expect(recorded.counts).toEqual({ members: 3, projects: 2, tasks: 2 });
    expect(recorded.members[0]).toEqual({
      id: "u-1",
      name: "Ada Byron",
      href: "/time?range=all&member=u-1",
      tracked: "10.0 h",
      idle: "1.0 h",
      entries: "4",
    });
    // Two "Design" Projects are told apart by their Client.
    expect(recorded.projects.map((row) => [row.name, row.client, row.href])).toEqual([
      ["Design", "Acme", "/projects/prj-1"],
      ["Design", null, "/projects/prj-2"],
    ]);
    expect(recorded.tasks[0]).toMatchObject({ name: "Survey", project: "Design", client: "Acme", href: "/time/projects?project=prj-1" });
    // A Task with no Project has a name and no link; it still has a key.
    expect(recorded.tasks[1]).toMatchObject({ id: "task-1", name: "Loose", href: null });
  });

  it("keeps every Task, not the first 20, and shows the first 20 with one button for the rest", () => {
    const many = Array.from({ length: 100 }, (_, index) => ({
      taskId: `t-${index}`,
      taskName: `Task ${index}`,
      crmProjectId: "prj-1",
      projectName: "Design",
      clientName: null,
      totalSeconds: 3600,
    }));
    expect(composeRecordedTime({ ...PRODUCTIVITY, byTask: many }).tasks).toHaveLength(100);
    const closed = limitRows(many, 20, false);
    expect(closed.rows).toHaveLength(20);
    expect(closed.toggle).toEqual({ label: "Show all 100", expanded: false });
    const open = limitRows(many, 20, true);
    expect(open.rows).toHaveLength(100);
    expect(open.toggle).toEqual({ label: "Show 20", expanded: true });
    // Nothing hidden, no button.
    expect(limitRows(many.slice(0, 20), 20, false).toggle).toBeNull();
  });

  it("is empty only when nothing at all was recorded", () => {
    const empty = composeRecordedTime({ byUser: [], byProject: [], byTask: [], dailyTrend: [] });
    expect(empty.empty).toBe(true);
    expect(empty.counts).toEqual({ members: 0, projects: 0, tasks: 0 });
  });

  it("draws shadcn Tabs kept in the address, numbers right-aligned on their heads' edge", () => {
    expect(analyticsSource).toContain('from "@/components/ui/tabs"');
    expect(analyticsSource).toContain("<TabsList");
    expect(analyticsSource).toContain('<TabsContent value="members"');
    expect(analyticsSource).toContain('<TabsContent value="projects"');
    expect(analyticsSource).toContain('<TabsContent value="tasks"');
    expect(analyticsSource).toContain("onTab={(tab) => setFilters({ ...filters, tab })}");
    expect(analyticsSource).toContain('data-align={align(index)}');
    expect(rule('.df-analytics-register :is(.df-register-head, .df-register-row) > [data-align="end"]')).toMatch(
      /text-align:\s*end/,
    );
    expect(rule('.df-analytics-register :is(.df-register-head, .df-register-row) > [data-align="end"]')).toMatch(
      /font-variant-numeric:\s*tabular-nums/,
    );
    // Only the name is a link, in the app's usual look (inherits, underlines on hover).
    expect(analyticsSource).toContain('className="df-row-link df-analytics-link"');
    expect(rule(".df-analytics-link:hover")).toMatch(/text-decoration:\s*underline/);
  });

  it("keeps its empty state in the shared component", () => {
    expect(analyticsSource).toContain("<V2CompactEmpty>No tracked time in this range</V2CompactEmpty>");
  });
});

describe("Hours per day (F95, F100)", () => {
  it("gives every day of the Range a bar, those without time as 0", () => {
    const chart = composeHoursChart(PRODUCTIVITY.dailyTrend, RANGE);
    expect(chart.grain).toBe("day");
    expect(chart.points.map((point) => point.label)).toEqual([
      "8 Sep", "9 Sep", "10 Sep", "11 Sep", "12 Sep", "13 Sep", "14 Sep",
    ]);
    expect(chart.points.map((point) => point.hours)).toEqual([0, 0, 10, 2, 0, 0, 0]);
    expect(chart.points[2].tracked).toBe("10.0 h");
    expect(chart.empty).toBe(false);
    expect(chart.table).toEqual({
      columns: ["Day", "Tracked"],
      rows: chart.points.map((point) => [point.label, point.tracked]),
    });
  });

  it("is empty when nothing was tracked, and ignores days outside the Range", () => {
    expect(composeHoursChart([], RANGE).empty).toBe(true);
    expect(composeHoursChart([{ date: "2026-01-01", totalSeconds: 3600 }], RANGE).empty).toBe(true);
  });

  it("turns into weeks from Monday past 45 days, the cut first and last weeks holding only their days", () => {
    // 90 days ending Mon 14 Sep 2026: 17 Jun to 14 Sep.
    const range = analyticsRange("90d", NOW);
    const chart = composeHoursChart(
      [
        { date: "2026-06-17", totalSeconds: 3600 },
        { date: "2026-06-21", totalSeconds: 7200 },
        { date: "2026-09-14", totalSeconds: 1800 },
      ],
      range,
    );
    expect(chart.grain).toBe("week");
    expect(chart.points[0].label).toBe("Week of 15 Jun");
    expect(chart.points[0].hours).toBe(3);
    expect(chart.points.at(-1)).toMatchObject({ label: "Week of 14 Sep", hours: 0.5 });
    expect(chart.table.columns).toEqual(["Week", "Tracked"]);
    // 45 days is still days; 46 are weeks.
    expect(composeHoursChart([], { start: new Date(2026, 7, 1), end: new Date(2026, 8, 14, 23, 59, 59, 999) }).grain).toBe("day");
    expect(composeHoursChart([], { start: new Date(2026, 6, 31), end: new Date(2026, 8, 14, 23, 59, 59, 999) }).grain).toBe("week");
  });

  it("draws one series with no animation, in the first chart color, with a Table toggle", () => {
    expect(chartsSource).toContain('color: "var(--df-chart-1)"');
    expect(chartsSource).not.toMatch(/<Line\b|stackId/);
    expect(analyticsSource).toContain("<ChartCard");
    expect(analyticsSource).toContain('title="Hours per day"');
    expect(chartsSource).toContain("`${value} h`");
  });
});

describe("The figure band and the warnings (F96)", () => {
  it("reads five figures from the portions of time, with Members counting those that have time", () => {
    expect(composeFigureBand(PRODUCTIVITY, COVERAGE)).toEqual([
      { label: "Tracked", value: "12.0 h" },
      { label: "Idle", value: "1.2 h" },
      { label: "Time Entries", value: "6" },
      { label: "Members", value: "2" },
      { label: "Capture coverage", value: "42%" },
    ]);
  });

  it("shows '-' for a figure whose read is missing, never 0", () => {
    expect(composeFigureBand(undefined, COVERAGE).map((figure) => figure.value)).toEqual(["-", "-", "-", "-", "42%"]);
    expect(composeFigureBand(PRODUCTIVITY, undefined).at(-1)).toEqual({ label: "Capture coverage", value: "-" });
    expect(composeFigureBand(PRODUCTIVITY, { ...COVERAGE, summary: { ...COVERAGE.summary, coveragePercent: null } }).at(-1)?.value).toBe("-");
  });

  it("says idle is beside the tracked time, and never 'of which idle'", () => {
    expect(analyticsSource).toContain("FIGURE_NOTE");
    expect(read("../../client/src/v2/analytics.ts")).toContain(
      "Idle time is beside the tracked time, not in it. Running Timers count up to now.",
    );
    expect(analyticsSource).not.toMatch(/of which idle|Idle events|Low activity/i);
  });

  it("names three groups of warnings, each only when it has rows", () => {
    const alerts: AnalyticsAlertsInput = {
      highIdleUsers: [{ userId: "u-1", userName: "Ada Byron", idleRatio: 61.6, totalSeconds: 36000 }],
      stalledDevices: [
        {
          deviceId: "dev-quiet",
          deviceName: "Quiet Mac",
          userId: "u-2",
          userName: "Grace Hopper",
          lastSeenAt: "2026-09-05T12:00:00.000Z",
          daysSinceLastSeen: 9,
        },
      ],
      runningWithoutScreenshots: [
        { userId: "u-1", userName: "Ada Byron", entryId: "entry-1", startedAt: new Date(2026, 8, 14, 9, 15).toISOString() },
      ],
    };
    const warnings = composeWarnings(alerts, NOW);
    expect(warnings.empty).toBe(false);
    expect(warnings.stalledDevices).toEqual([{ id: "dev-quiet", name: "Quiet Mac", who: "Grace Hopper", lastSeen: "9d ago" }]);
    expect(warnings.mostlyIdle).toEqual([{ id: "u-1", who: "Ada Byron", tracked: "10.0 h", idle: "62%" }]);
    expect(warnings.runningWithoutCaptures).toEqual([{ id: "entry-1", who: "Ada Byron", started: "2h ago" }]);
    for (const label of ["Stalled Devices", "Mostly idle", "Running without captures"]) {
      expect(analyticsSource).toContain(`>${label}</p>`);
    }
    expect(composeWarnings({ highIdleUsers: [], stalledDevices: [], runningWithoutScreenshots: [] }, NOW).empty).toBe(true);
    expect(analyticsSource).toContain("<V2CompactEmpty>No warnings</V2CompactEmpty>");
    expect(analyticsSource).toContain('aria-expanded={shown.toggle.expanded}');
  });
});

describe("Captures and Devices (F94, F99)", () => {
  it("counts captures against what the Tracking Policy expects, and names the policy's interval", () => {
    const captures = composeCaptures(COVERAGE, RANGE);
    expect(captures.figures).toEqual([
      { label: "Taken", value: "412" },
      { label: "Expected", value: "980" },
      { label: "Time Entries without any", value: "2" },
    ]);
    expect(captures.line).toBe(
      "Screenshots the desktop app takes while a Timer runs. Expected: one per 5 minutes of tracked time, as the Tracking Policy asks.",
    );
    expect(captureLine(null)).toBe("Screenshots the desktop app takes while a Timer runs. They are off in the Tracking Policy.");
    expect(captureLine(undefined)).toBe(captureLine(null));
    expect(captureLine(1)).toContain("one per minute of tracked time");
  });

  it("says nothing was taken once, and charts no hour without a capture", () => {
    const none = { ...COVERAGE, summary: { ...COVERAGE.summary, totalScreenshots: 0 } };
    expect(composeCaptures(COVERAGE, RANGE)).toMatchObject({ empty: false, noneTaken: false });
    expect(composeCaptures(none, RANGE)).toMatchObject({ empty: false, noneTaken: true });
    expect(composeCaptures({ ...none, byUser: [] }, RANGE)).toMatchObject({ empty: true, noneTaken: true });
    expect(analyticsSource).toContain("captures.noneTaken ? null : hourly.state");
  });

  it("lists Members in the order the server gives, with '412 of 980' and a coverage that can be unknown", () => {
    const { rows } = composeCaptures(COVERAGE, RANGE);
    expect(rows.map((row) => [row.name, row.tracked, row.captures, row.coverage])).toEqual([
      ["Ada Byron", "10.0 h", "412 of 980", "42%"],
      ["Grace Hopper", "2.0 h", "0 of 0", "-"],
    ]);
  });

  it("links a Member to Activity over the Range's own days", () => {
    expect(memberActivityHref("u-1", RANGE)).toBe("/activity?range=custom&from=2026-09-08&to=2026-09-14&member=u-1");
    expect(memberTimeHref("u-1")).toBe("/time?range=all&member=u-1");
  });

  it("draws the 24 hours, 00:00 to 23:00, those without a capture as 0", () => {
    const hourly = composeHourly({ totalCount: 5, hourlyDistribution: [{ hour: 9, count: 3 }, { hour: 14, count: 2 }] });
    expect(hourly.empty).toBe(false);
    expect(hourly.points).toHaveLength(24);
    expect(hourly.points[0]).toEqual({ hour: 0, label: "00:00", count: 0 });
    expect(hourly.points[9].count).toBe(3);
    expect(hourly.points[23].label).toBe("23:00");
    expect(hourly.table.columns).toEqual(["Hour", "Captures"]);
    expect(composeHourly({ totalCount: 0, hourlyDistribution: [] }).empty).toBe(true);
  });

  it("says Active and Revoked in sentence case", () => {
    const rows = composeDevices(
      [
        { id: "d-1", userId: "u-1", userName: "Ada Byron", name: "Ada MacBook", os: "macOS", clientVersion: "1.4.0", lastSeenAt: new Date(2026, 8, 14, 11, 30).toISOString(), revokedAt: null },
        { id: "d-2", userId: "u-2", userName: "Grace Hopper", name: "Old ThinkPad", os: null, clientVersion: null, lastSeenAt: null, revokedAt: "2026-09-10T00:00:00.000Z" },
      ],
      NOW,
    );
    expect(rows.map((row) => [row.platform, row.lastSeen, row.status])).toEqual([
      ["macOS · 1.4.0", "30m ago", "Active"],
      ["-", "Never", "Revoked"],
    ]);
    expect(analyticsDevicesPath("Africa/Porto-Novo")).toBe("/api/admin/analytics/devices?tz=Africa%2FPorto-Novo");
  });

  it("splits Captures in two reads that fail alone, and never says grade, score or rank", () => {
    expect(analyticsSource).toContain("hourly.state === \"failed\"");
    expect(analyticsSource).not.toMatch(/grade|rank|tombstone|duplicate/i);
  });
});

describe("Administration shows one configuration section at a time (#281)", () => {
  it("keeps the tab in the path, with Workspace as the destination itself", () => {
    expect(ADMINISTRATION_TAB_IDS).toEqual([
      "workspace",
      "billing",
      "tracking-policy",
      "pipeline-lists",
      "integrations",
      "support-access",
    ]);
    expect(administrationTabHref("workspace")).toBe("/administration");
    expect(administrationTabHref("billing")).toBe("/administration/billing");
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
      { label: "Harbor Co", href: "/" },
      { label: "Administration", href: "/administration" },
      { label: "Tracking Policy" },
    ]);
    // Danger zone folded back into Billing; its old address opens Billing.
    expect(matchV2Route("/administration/danger-zone")).toMatchObject({
      kind: "administration",
      tab: "billing",
      href: "/administration/billing",
    });
    expect(appSource).toMatch(
      /<Route path="\/administration\/danger-zone">\s*<Redirect to="\/administration\/billing" \/>/,
    );
    expect(appSource.indexOf('path="/administration/danger-zone"')).toBeLessThan(
      appSource.indexOf('path="/administration/:tab?"'),
    );
    // CRM fields became Pipeline & lists; its old address opens the new tab.
    expect(matchV2Route("/administration/crm-fields")).toMatchObject({
      kind: "administration",
      tab: "pipeline-lists",
      href: "/administration/pipeline-lists",
    });
    expect(appSource).toMatch(
      /<Route path="\/administration\/crm-fields">\s*<Redirect to="\/administration\/pipeline-lists" \/>/,
    );
    expect(appSource.indexOf('path="/administration/crm-fields"')).toBeLessThan(
      appSource.indexOf('path="/administration/:tab?"'),
    );
    // Members & Roles went: its address opens People, which holds the Members and their Roles (F110).
    expect(matchV2Route("/administration/members")).toEqual({ kind: "people", title: "People", href: "/people" });
    expect(appSource).toMatch(/<Route path="\/administration\/members">\s*<Redirect to="\/people" \/>/);
    expect(appSource.indexOf('path="/administration/members"')).toBeLessThan(appSource.indexOf('path="/administration/:tab?"'));
    // A tab that does not exist lands on Workspace rather than an empty page.
    expect(adminSource).toContain('navigate(administrationTabHref("workspace"), { replace: true })');
  });

  it("offers every tab to the Owner and Administrators, and none to a Member", () => {
    const owner = administrationTabs("billing", "Owner");
    expect(owner.map((tab) => tab.label)).toEqual([
      "Workspace",
      "Billing",
      "Tracking Policy",
      "Pipeline and lists",
      "Integrations",
      "Support access",
    ]);
    expect(owner.filter((tab) => tab.active).map((tab) => tab.id)).toEqual(["billing"]);
    expect(administrationTabs("workspace", "ADMINISTRATOR")).toHaveLength(6);
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
    // Each panel renders its tab's own file, which reads only what it shows (F107).
    const panel = (id: string) => {
      const start = adminSource.indexOf(`<TabsContent value="${id}"`);
      return adminSource.slice(start, adminSource.indexOf("</TabsContent>", start));
    };
    expect(panel("workspace")).toContain("<V2AdministrationWorkspace");
    expect(panel("billing")).toContain("<V2AdministrationBilling");
    expect(panel("tracking-policy")).toContain("<V2AdministrationTrackingPolicy");
    expect(panel("pipeline-lists")).toContain("<V2AdministrationPipelineLists");
    expect(panel("integrations")).toContain("<V2AdministrationIntegrations");
    expect(panel("support-access")).toContain("<V2SupportAccess");
    expect(adminSource).not.toContain("useQuery");
    const tab = (name: string) => read(`../../client/src/v2/${name}`);
    expect(adminBillingSource).toContain('data-testid="v2-administration-billing"');
    expect(tab("V2AdministrationPipelineLists.tsx")).toContain('data-testid="v2-administration-pipeline-lists"');
    expect(tab("V2AdministrationPipelineLists.tsx")).toContain("<PipelineListCard");
    expect(tab("V2AdministrationIntegrations.tsx")).toContain('data-testid="v2-administration-service-accounts"');
    expect(tab("V2AdministrationIntegrations.tsx")).toContain('data-testid="v2-administration-secret"');
    expect(tab("V2AdministrationTrackingPolicy.tsx")).toContain('data-testid="v2-administration-tracking-policy"');
    // The Workspace time zone moved to the Workspace tab; Screencasts timezones left v2 (F110).
    expect(adminWorkspaceSource).toContain('data-testid="v2-administration-workspace-timezone"');
    expect(adminPagesSource).not.toContain('data-testid="v2-administration-timezones"');
    expect(adminBillingSource).toContain('testId="v2-administration-billing-cancel"');
    expect(adminSource).not.toContain('value="danger-zone"');
    expect(adminSource).not.toContain('value="members"');
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
    expect(adminBillingSource).toContain('administrationTabHref("billing")');
  });

  it("scrolls the strip without a bar on a phone and brings the open tab into view (F110)", () => {
    expect(adminSource).toContain('?.querySelector<HTMLElement>(\'[data-state="active"]\')');
    expect(adminSource).toContain('?.scrollIntoView({ block: "nearest", inline: "nearest" });');
    expect(adminSource).toContain("<TabsList ref={strip}");
    expect(css).toMatch(/\.df-admin-tabs \.df-tabs::-webkit-scrollbar \{\s*display: none;/);
    // DESIGN.md: never scrollbar-width on the element outside the Firefox fallback.
    expect(css).toMatch(/@supports not selector\(::-webkit-scrollbar\) \{\s*\.df-admin-tabs \.df-tabs \{\s*scrollbar-width: none;/);
    expect(rule(".df-admin-tabs .df-tabs")).toBe("");
  });

  it("wears the v2 tab strip over shadcn's pill, in tokens that hold in the dark palette", () => {
    const active = rule('.df-v2 .df-tab[data-state="active"]');
    expect(active).toMatch(/border-bottom-color:\s*var\(--df-amber-500\)/);
    expect(active).toMatch(/color:\s*var\(--df-case-ink\)/);
    expect(rule('.df-v2 .df-tabs[role="tablist"]')).toMatch(/background:\s*transparent/);
    expect(rule('.df-v2 .df-tab[role="tab"]')).toMatch(/padding:\s*var\(--df-space-2\) var\(--df-space-3\)/);
    expect(rule(".df-v2 .df-admin-panel")).toMatch(/gap:\s*var\(--df-space-5\)/);
    expect(rule(".df-danger-row")).toMatch(/border-top:\s*1px solid var\(--df-alert-line\)/);
    expect(rule(".df-danger-row")).toMatch(/padding:\s*var\(--df-space-4\)/);
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

describe("The Workspace and Billing tabs (#281, F110)", () => {
  it("states who owns the Workspace and the Role the reader holds", () => {
    const card = composeWorkspaceCard(
      workspaceInput({
        workspaceRole: "ADMINISTRATOR",
        members: [
          { firstName: "Sam", lastName: "Lee", email: "sam@harbor.test", workspaceRole: "Owner" },
          { firstName: "Ada", lastName: "Byron", email: "ada@harbor.test", workspaceRole: "ADMINISTRATOR" },
        ],
      }),
    );
    expect(card).toEqual({
      name: "Harbor Co",
      initials: "HC",
      roleBadge: "You are Administrator",
      renamable: false,
      renameNote: "Only the Owner, Sam Lee, can rename the Workspace.",
      owner: { name: "Sam Lee", initials: "SL" },
      members: "2 Members",
    });
  });

  it("lets the Owner alone rename the Workspace, through a Rename button and a dialog", () => {
    expect(composeWorkspaceCard(workspaceInput({ workspaceRole: "OWNER" }))).toMatchObject({ renamable: true, renameNote: null });
    expect(adminWorkspaceSource).toContain('apiRequest("PATCH", workspacePath(), { name })');
    // The chrome reads the name from /api/memberships, so a rename refreshes that.
    expect(adminWorkspaceSource).toContain('const CHROME_MEMBERSHIPS_KEY = ["/api/memberships"];');
    expect(adminWorkspaceSource).toContain("{card.renamable ? (");
    expect(adminWorkspaceSource).toContain('data-testid="v2-administration-workspace-rename"');
    expect(adminWorkspaceSource).toContain("<V2FormDialog");
    expect(adminWorkspaceSource).toContain('title="Rename Workspace"');
    expect(adminWorkspaceSource).toContain('testId="v2-administration-workspace-rename-dialog"');
    expect(adminWorkspaceSource).not.toContain("df-admin-rename");
    expect(adminWorkspaceSource).not.toContain("df-inline-form");
    expect(css).not.toContain(".df-admin-rename");
  });

  it("leaves the owner and members empty when unknown, and singularises one Member", () => {
    const unknown = composeWorkspaceCard(workspaceInput({ workspaceRole: "ADMINISTRATOR", ownerName: null, members: undefined }));
    expect(unknown.owner).toBeNull();
    expect(unknown.members).toBeNull();
    expect(unknown.renameNote).toBe("Only the Owner can rename the Workspace.");

    const one = composeWorkspaceCard(
      workspaceInput({
        members: [{ firstName: "Sam", lastName: "Lee", email: "sam@harbor.test", workspaceRole: "Owner" }],
      }),
    );
    expect(one.members).toBe("1 Member");
  });

  it("sends a change of Role to People: Members & Roles is gone", () => {
    expect(adminWorkspaceSource).toContain('<Link href="/people"');
    expect(adminPagesSource).not.toContain("Members &amp; Roles");
    expect(adminPagesSource).not.toContain("v2-administration-members");
  });

  it("keeps Cancel at period end on Billing, in its own row below the routine actions", () => {
    const billing = composeBilling({
      billing: {
        planKey: "pro",
        billingState: "Active",
        purchasedSeatCapacity: 8,
        consumedSeatCount: 3,
        trialEndsAt: null,
        periodEndsAt: "2026-10-01T00:00:00.000Z",
        cancelAtPeriodEnd: false,
        stripeCustomerId: "cus_123",
        canCancel: true,
      },
      condition: null,
    });
    const cancel = billing.actions.find((action) => action.tone === "destructive");
    expect(cancel?.id).toBe("cancel");
    expect(cancel?.consequence).toBeTruthy();
    expect(billing).not.toHaveProperty("dangerZone");

    const routine = adminBillingSource.indexOf('className="df-billing-actions"');
    const row = adminBillingSource.indexOf('data-testid="v2-administration-billing-cancel-row"');
    expect(routine).toBeGreaterThan(-1);
    expect(row).toBeGreaterThan(routine);
    expect(adminBillingSource.slice(row)).toContain("{cancel.consequence}");
    expect(adminBillingSource.slice(row)).toContain("<DestructiveConfirm");
    expect(adminPagesSource).not.toContain("Ending the Subscription is under");
    expect(adminPagesSource).not.toContain("Danger zone");
  });
});

describe("A destructive row action asks before it runs (#281)", () => {
  it("confirms removing a list option and revoking a Service Account in an AlertDialog", () => {
    expect(adminPagesSource).toContain("export function DestructiveConfirm(");
    expect(adminPagesSource).toMatch(/<DestructiveConfirm\s+(?:\w+=\{\w+\}\s+)*label="Remove"\s+title=\{`Remove \$\{row\.label\}`\}\s+consequence=\{row\.removeConsequence\}/);
    expect(adminPagesSource).toMatch(/<DestructiveConfirm\s+(?:\w+=\{\w+\}\s+)*label="Revoke"/);
    // No press mutates on its own.
    expect(adminPagesSource).not.toMatch(/onClick=\{\(\) => onEdit\(removePipelineOption/);
    expect(adminPagesSource).not.toMatch(/onClick=\{\(\) => onRevoke\(/);
    const confirm = adminPagesSource.slice(adminPagesSource.indexOf("export function DestructiveConfirm("));
    expect(confirm).toContain("<AlertDialogCancel className=\"df-btn\" autoFocus>");
    // The trigger reads as destructive; only a neutral question drops the red.
    expect(confirm).toContain('variant={destructive ? "destructiveOutline" : "outline"}');
  });
});

describe("The Range: whole local days ending today, kept in the address (#307, F95)", () => {
  // TZ is pinned to UTC, so local midnight is UTC midnight here; the days are built the local way regardless.
  const MID_MONTH = new Date(2026, 8, 15, 14, 30);
  const query = (path: string) => new URL(path, "http://docuflow.test").searchParams;

  it("offers the rolling ranges as the last N days, then This month and a custom range", () => {
    expect(ANALYTICS_RANGE_PRESETS.map((preset) => [preset.id, preset.label])).toEqual([
      ["7d", "Last 7 days"],
      ["30d", "Last 30 days"],
      ["90d", "Last 90 days"],
      ["month", "This month"],
      ["custom", "Custom range…"],
    ]);
  });

  it("ends the rolling ranges at the end of today and starts them on a midnight", () => {
    const week = analyticsRange("7d", MID_MONTH);
    expect(week.start).toEqual(new Date(2026, 8, 9));
    expect(week.end).toEqual(new Date(2026, 8, 15, 23, 59, 59, 999));
    expect(analyticsRange("30d", MID_MONTH).start).toEqual(new Date(2026, 7, 17));
    expect(analyticsRange("90d", MID_MONTH).start).toEqual(new Date(2026, 5, 18));
  });

  it("starts This month on the 1st and ends today, which the last 30 days does not", () => {
    expect(analyticsRange("month", MID_MONTH)).toEqual({
      start: new Date(2026, 8, 1),
      end: new Date(2026, 8, 15, 23, 59, 59, 999),
    });
    expect(analyticsRange("month", new Date(2026, 9, 1, 9, 0)).start).toEqual(new Date(2026, 9, 1));
  });

  it("steps over a change of clock by the calendar, not by 24 hours", () => {
    // Europe/Paris 2026-10-25 has 25 hours; the week before it still starts at midnight on the 19th.
    const week = analyticsRange("7d", new Date(2026, 9, 25, 10, 0));
    expect([week.start.getDate(), week.start.getHours()]).toEqual([19, 0]);
  });

  it("covers both end days of a custom range in full, and swaps them when reversed", () => {
    expect(analyticsRange("custom", MID_MONTH, { from: "2026-09-03", to: "2026-09-10" })).toEqual({
      start: new Date(2026, 8, 3),
      end: new Date(2026, 8, 10, 23, 59, 59, 999),
    });
    expect(analyticsRange("custom", MID_MONTH, { from: "2026-09-10", to: "2026-09-03" }).start).toEqual(new Date(2026, 8, 3));
    // No days yet reads as the default week.
    expect(analyticsRange("custom", MID_MONTH, null)).toEqual(analyticsRange("7d", MID_MONTH));
  });

  it("picks Custom from the days on screen without asking for anything new", () => {
    const week = analyticsRange("7d", MID_MONTH);
    const custom = analyticsRange("custom", MID_MONTH, customFromRange(week));
    expect(custom).toEqual(week);
    for (const report of ["productivity", "coverage", "alerts", "screenshots"] as const) {
      expect(analyticsPath(report, custom, "Africa/Porto-Novo")).toBe(analyticsPath(report, week, "Africa/Porto-Novo"));
    }
  });

  it("carries start, end and the time zone on every read, the export too", () => {
    const week = analyticsRange("7d", MID_MONTH);
    for (const report of ["productivity", "coverage", "alerts", "screenshots", "export"] as const) {
      const params = query(analyticsPath(report, week, "Africa/Porto-Novo"));
      expect([params.get("start"), params.get("end"), params.get("tz")]).toEqual([
        week.start.toISOString(),
        week.end.toISOString(),
        "Africa/Porto-Novo",
      ]);
    }
    expect(analyticsPath("export", week, "UTC").startsWith("/api/admin/analytics/export?")).toBe(true);
  });

  it("names the Range in words, with the year when it is not this one", () => {
    expect(analyticsRangeWords(analyticsRange("7d", new Date(2026, 10, 25)), new Date(2026, 10, 25))).toBe("19 Nov - 25 Nov");
    expect(analyticsRangeWords(analyticsRange("custom", MID_MONTH, { from: "2025-12-30", to: "2026-01-02" }), MID_MONTH)).toBe(
      "30 Dec 2025 - 2 Jan 2026",
    );
    expect(analyticsRangeWords(analyticsRange("custom", MID_MONTH, { from: "2026-09-03", to: "2026-09-03" }), MID_MONTH)).toBe("3 Sep");
    expect(analyticsRangeWords(RANGE, NOW)).not.toMatch(/\u2013|\u2014/);
  });

  it("round-trips through the address, leaving the defaults out", () => {
    expect(ANALYTICS_FILTERS_DEFAULT).toEqual({ range: "7d", from: "", to: "", tab: "members" });
    expect(writeAnalyticsFilters("", ANALYTICS_FILTERS_DEFAULT)).toBe("");
    for (const filters of [
      { range: "30d", from: "", to: "", tab: "projects" },
      { range: "90d", from: "", to: "", tab: "members" },
      { range: "month", from: "", to: "", tab: "tasks" },
      { range: "custom", from: "2026-09-03", to: "2026-09-10", tab: "members" },
    ] as const) {
      expect(readAnalyticsFilters(writeAnalyticsFilters("", filters))).toEqual(filters);
    }
    expect(writeAnalyticsFilters("", { range: "custom", from: "2026-09-03", to: "2026-09-10", tab: "tasks" })).toBe(
      "?range=custom&from=2026-09-03&to=2026-09-10&tab=tasks",
    );
    // The dates only travel with Custom, and other parameters are kept.
    expect(writeAnalyticsFilters("?range=custom&from=2026-09-03&to=2026-09-10&x=1", { range: "30d", from: "", to: "", tab: "members" })).toBe(
      "?range=30d&x=1",
    );
  });

  it("reads an unknown value as its default", () => {
    expect(readAnalyticsFilters("?range=forever&tab=nope")).toEqual(ANALYTICS_FILTERS_DEFAULT);
    // Custom needs both real days.
    expect(readAnalyticsFilters("?range=custom")).toEqual(ANALYTICS_FILTERS_DEFAULT);
    expect(readAnalyticsFilters("?range=custom&from=2026-09-03&to=2026-13-40").range).toBe("7d");
    expect(readAnalyticsFilters("?range=custom&from=2026-09-03&to=2026-09-10").range).toBe("custom");
  });

  it("moves each choice into the history, so Back works", () => {
    expect(analyticsSource).toContain("navigate(`/analytics${writeAnalyticsFilters(search, next)}`)");
    expect(analyticsSource).not.toContain("replace: true");
  });

  it("reads the old figures against the Range they were read for while a new one arrives", () => {
    expect(analyticsSource).toContain("if (!query.isPlaceholderData) settled.current = range;");
    expect(analyticsSource).toContain("composeHoursChart(read.data.dailyTrend, read.range)");
    expect(analyticsSource).toContain("composeCaptures(read.data, read.range)");
  });

  it("keeps the last figures, dimmed, while a new Range arrives", () => {
    expect(analyticsSource).toContain("placeholderData: keepPreviousData");
    expect(analyticsSource).toContain("staleTime: 0");
    expect(analyticsSource).toContain('data-refreshing={refreshing ? "true" : undefined}');
    expect(analyticsSource).toContain("aria-busy={refreshing || undefined}");
    expect(rule('.df-page [data-refreshing="true"]')).toMatch(/opacity:\s*0\.6/);
    // A failed refresh with figures on screen is a toast, shared with Activity and People.
    expect(analyticsSource).toContain("useRefreshFailure(");
    expect(read("../../client/src/v2/V2Activity.tsx")).toContain('from "./useRefreshFailure"');
    expect(read("../../client/src/v2/V2People.tsx")).toContain('from "./useRefreshFailure"');
    expect(read("../../client/src/v2/V2Activity.tsx")).not.toContain("function useRefreshFailure");
    expect(read("../../client/src/v2/V2People.tsx")).not.toContain("function useRefreshFailure");
  });

  it("picks the custom range on one shadcn range calendar, beside the Range select", () => {
    expect(analyticsSource).toContain("<V2DateRangeField");
    const picker = read("../../client/src/v2/V2DateField.tsx");
    expect(picker).toContain('mode="range"');
    expect(picker).toContain("numberOfMonths={2}");
  });
});

describe("The Export saves the file the server names (F98)", () => {
  const range = analyticsRange("7d", new Date(2026, 8, 15));

  it("reads the filename from Content-Disposition, plain or encoded, and falls back to the Range's days", () => {
    expect(exportFilename('attachment; filename="docuflow-time-2026-09-09-to-2026-09-15.csv"', range)).toBe(
      "docuflow-time-2026-09-09-to-2026-09-15.csv",
    );
    expect(exportFilename("attachment; filename*=UTF-8''docuflow-time-a-to-b.csv", range)).toBe("docuflow-time-a-to-b.csv");
    expect(exportFilename(null, range)).toBe("docuflow-time-2026-09-09-to-2026-09-15.csv");
  });

  it("is a Button that fetches a blob, keeps its label with a spinner, and toasts a failure", () => {
    expect(analyticsSource).toContain("res.blob()");
    expect(analyticsSource).toContain("if (!res.ok)");
    expect(analyticsSource).toContain("notify.error(error, { fallback:");
    expect(analyticsSource).toContain("Export CSV");
    expect(analyticsSource).toContain("<Loader2");
    expect(analyticsSource).not.toMatch(/<a[\s>]/);
  });
});

describe("The page on a phone and in the dark (F100)", () => {
  it("starts a stacked row's text where its card's text starts", () => {
    expect(rule('.df-v2[data-chrome="mobile"] .df-analytics-register .df-register-row')).toMatch(
      /padding-inline:\s*var\(--df-space-4\)/,
    );
    expect(rule(".df-analytics-group-label")).toMatch(/padding:\s*var\(--df-space-4\) var\(--df-space-4\) var\(--df-space-2\)/);
  });

  it("uses tokens alone, and no dash in what the page says", () => {
    for (const selector of [
      ".df-analytics-subhead-title",
      ".df-analytics-tabs",
      ".df-analytics-more",
      '.df-page [data-refreshing="true"]',
    ]) {
      expect(rule(selector)).not.toMatch(/#[0-9a-f]{3,6}\b/i);
    }
    for (const source of [analyticsSource, chartsSource, read("../../client/src/v2/analytics.ts")]) {
      expect(source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")).not.toMatch(/[\u2013\u2014]/);
    }
  });
});

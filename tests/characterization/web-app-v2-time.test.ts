import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { motionForSurface } from "../../client/src/v2/motion";
import { breadcrumbFor, matchV2Route, navIdForPath } from "../../client/src/v2/presentation";
import {
  composeTimeStats,
  composeTimeTracking,
  timeEntriesPath,
  type TimeStatsInput,
  type TimeTrackingInput,
} from "../../client/src/v2/time";
import {
  composeDailyUpdatePage,
  type DailyUpdatePageInput,
} from "../../client/src/v2/dailyUpdate";

/**
 * Time Tracking and Daily Update from live time (#190).
 * Seams: matchV2Route (flagged app chrome) and compose helpers over existing `/api/*`.
 * Do not assert hex values or the prototype DOM. No new BFF routes.
 */

const SAMPLE_NAMES = ["Keystone", "Northwind", "Amina", "Kofi", "Elena", "Jules", "Meridian", "Kaleido"];

const appSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2/V2AuthenticatedApp.tsx"),
  "utf8",
);

const pageSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2/V2Time.tsx"),
  "utf8",
);

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2/tokens.css"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

const dailyPageSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2/V2DailyUpdate.tsx"),
  "utf8",
);

function emptyTime(overrides: Partial<TimeTrackingInput> = {}): TimeTrackingInput {
  return {
    now: new Date(2026, 8, 10, 15, 0, 0),
    workspaceName: "Harbor Co",
    currentUserId: "me",
    isAdmin: false,
    isRunning: false,
    displayDuration: 0,
    activeEntryId: null,
    entries: [],
    workdaySeconds: 0,
    ...overrides,
  };
}

describe("Time Tracking and Daily Update routing (#190)", () => {
  it("shows a live Time Tracking destination on /time, not a placeholder", () => {
    const match = matchV2Route("/time");
    expect(match.kind).toBe("time");
    expect(navIdForPath("/time")).toBe("time");
    expect(breadcrumbFor("/time", "Harbor Co").map((crumb) => crumb.label)).toEqual([
      "HARBOR CO",
      "TIME TRACKING",
    ]);
    expect(appSource).toContain("V2TimePage");
    expect(appSource).toMatch(/path="\/time\/:tab\?"/);
    expect(appSource).not.toContain('data-testid="v2-placeholder"');
  });

  it("rewrites v1 /time-tracking URLs here and leaves Devices on the Devices ticket", () => {
    // The Time dashboard and Projects manager land on their own v2 tabs (#214).
    expect(matchV2Route("/time-tracking")).toMatchObject({ kind: "time", href: "/time" });
    expect(matchV2Route("/time-tracking/dashboard")).toMatchObject({ kind: "time", href: "/time/stats" });
    expect(matchV2Route("/time-tracking/projects")).toMatchObject({ kind: "time", href: "/time/projects" });
    expect(matchV2Route("/time-tracking/devices").kind).toBe("devices");
    expect(matchV2Route("/time-tracking/devices").href).toBe("/devices");
    expect(appSource).toMatch(/path="\/time-tracking"/);
    expect(JSON.stringify(matchV2Route("/time"))).not.toMatch(/timesheet/i);
  });

  it("shows a live Daily Update destination under v2, not a rewritten placeholder", () => {
    const match = matchV2Route("/daily-update");
    expect(match.kind).toBe("daily-update");
    expect(breadcrumbFor("/daily-update", "Harbor Co").map((crumb) => crumb.label)).toEqual([
      "HARBOR CO",
      "DAILY UPDATE",
    ]);
    expect(appSource).toContain("V2DailyUpdatePage");
    expect(appSource).toMatch(/path="\/daily-update"/);
  });
});

describe("Time Tracking from live Time Entries (#190)", () => {
  it("empty Workspace uses empty geometry and never shows sample names or a Timesheet", () => {
    const page = composeTimeTracking(emptyTime());
    const blob = JSON.stringify(page);

    expect(page.empty).toBe(true);
    expect(page.rows).toEqual([]);
    expect(page.emptyCopy.toLowerCase()).toContain("time entry");
    expect(page.workdayHours).toBe("0.0 h");
    expect(page.pagePrimary).toBe("case-ink");
    for (const name of SAMPLE_NAMES) {
      expect(blob).not.toContain(name);
    }
    expect(blob.toLowerCase()).not.toContain("timesheet");
  });

  it("lists Time Entries from the BFF and keeps one amber on the running Timer chip", () => {
    const page = composeTimeTracking(
      emptyTime({
        isRunning: true,
        displayDuration: 3661,
        activeEntryId: "te-run",
        workdaySeconds: 7200,
        entries: [
          {
            id: "te-run",
            startTime: new Date(2026, 8, 10, 9, 0, 0),
            duration: 120,
            status: "running",
            userId: "me",
            crmProjectId: "prj-1",
            taskId: "task-1",
            user: { firstName: "Sam", lastName: "Lee", email: "sam@example.com" },
            crmProject: { project: { name: "Harbour rebuild" }, client: { name: "Harbour Shipping" } },
            task: { name: "Reconcile import" },
          },
          {
            id: "te-stop",
            startTime: new Date(2026, 8, 9, 14, 30, 0),
            duration: 1800,
            status: "stopped",
            userId: "me",
            crmProjectId: "prj-1",
            user: { firstName: "Sam", lastName: "Lee", email: "sam@example.com" },
            crmProject: { project: { name: "Harbour rebuild" } },
          },
        ],
      }),
    );

    expect(page.empty).toBe(false);
    expect(page.workdayHours).toBe("2.0 h");
    expect(page.pagePrimary).toBe("case-ink");
    expect(page.rows[0]).toMatchObject({
      id: "te-run",
      project: "Harbour Shipping · Harbour rebuild",
      task: "Reconcile import",
      status: "RUNNING",
      duration: "01:01:01",
      holdsAmber: false,
      canDelete: false,
    });
    expect(page.rows[1]).toMatchObject({
      id: "te-stop",
      when: "YDA",
      status: "STOPPED",
      duration: "00:30:00",
      holdsAmber: false,
      canDelete: true,
    });
    expect(JSON.stringify(page).toLowerCase()).not.toContain("timesheet");
    expect(JSON.stringify(page)).not.toContain("Keystone");
  });

  it("asks the BFF for the filters it already supports", () => {
    const path = timeEntriesPath({
      startDate: new Date(Date.UTC(2026, 8, 10, 0, 0, 0)),
      endDate: new Date(Date.UTC(2026, 8, 10, 23, 59, 59, 999)),
      crmProjectId: "prj-live",
      status: "stopped",
      userId: "user-2",
    });
    const decoded = decodeURIComponent(path);
    expect(path.startsWith("/api/time-tracking/entries?")).toBe(true);
    expect(decoded).toContain("2026-09-10T00:00:00.000Z");
    expect(decoded).toContain("2026-09-10T23:59:59.999Z");
    expect(decoded).toContain("crmProjectId=prj-live");
    expect(decoded).toContain("status=stopped");
    expect(decoded).toContain("userId=user-2");
    expect(pageSource).toContain("/api/time-tracking/entries");
    expect(pageSource).toContain("/api/time-tracking/stats");
    expect(pageSource).toContain("useTimeTracker");
    expect(pageSource).not.toMatch(/timesheet/i);
    expect(pageSource).toMatch(/function onPrimary\([\s\S]*readOnly/);
    expect(pageSource).toMatch(/timeStatsPath\(\{[\s\S]*?startDate: startOfDay\(now\)/);
    expect(pageSource).not.toMatch(/timeStatsPath\(\{[^}]*rangeDates/);
  });

  it("keeps Remove on the stacked Time Entry row", () => {
    const stacked = pageSource.match(/layout\.stackedRegister \? \(([\s\S]*?)\) : \(/)?.[1] ?? "";
    expect(stacked).toContain("df-project-mobile");
    expect(stacked).toContain("Remove");
  });
});

describe("Daily Update from live writes (#190)", () => {
  it("empty Workday is honest and never shows sample names", () => {
    const page = composeDailyUpdatePage(emptyDaily());
    const blob = JSON.stringify(page);

    expect(page.kind).toBe("empty");
    expect(page.submissions).toEqual([]);
    expect(page.canSubmit).toBe(true);
    expect(page.refusal).toBeNull();
    for (const name of SAMPLE_NAMES) {
      expect(blob).not.toContain(name);
    }
  });

  it("says where today's Daily Update stands, as labelled rows, and what a Daily Update is", () => {
    const empty = composeDailyUpdatePage(emptyDaily());
    expect(empty.today.submitted).toBe(false);
    expect(empty.today.rows).toEqual([
      { label: "WORKDAY", value: "THU 10 SEP" },
      { label: "STATUS", value: "Not submitted yet" },
      { label: "PROJECTS COVERED", value: "None yet" },
    ]);
    expect(empty.today.copy).toMatch(/^A Daily Update is your one submission for this workday: progress grouped by Project, blockers and next plans\./);
    expect(empty.today.copy).toContain("Fill it in below");
    // The form below is the way to write it; no button repeats it.
    expect(empty.today.action).toBeNull();

    const submitted = composeDailyUpdatePage(
      emptyDaily({
        submissions: [
          { id: "du-1", crmProjectId: "prj-1", status: "on_track", createdAt: new Date(2026, 8, 10, 9, 41) },
          { id: "du-2", crmProjectId: "prj-2", status: "on_track", createdAt: new Date(2026, 8, 10, 11, 5), crmProject: { project: { name: "Pier survey" } } },
        ],
      }),
    );
    expect(submitted.today.submitted).toBe(true);
    expect(submitted.today.rows[1]).toEqual({ label: "STATUS", value: "Submitted at 11:05" });
    expect(submitted.today.rows[2]).toEqual({ label: "PROJECTS COVERED", value: "Harbour rebuild, Pier survey" });
    expect(submitted.today.copy).toContain("Add it below");

    const noProjects = composeDailyUpdatePage(emptyDaily({ projects: [] }));
    expect(noProjects.canSubmit).toBe(false);
    expect(noProjects.today.copy).toContain("no Project in this Workspace to report on yet");
    expect(noProjects.today.action).toEqual({ label: "Open Projects", href: "/projects" });
    expect(matchV2Route("/projects").kind).toBe("projects");

    const readOnly = composeDailyUpdatePage(emptyDaily({ readOnly: true, projects: [] }));
    expect(readOnly.today.action).toBeNull();
  });

  it("draws Today as a card of labelled rows, never a bare line, and keeps Submit a normal-size footer button", () => {
    expect(dailyPageSource).toContain('data-testid="v2-daily-update-today"');
    expect(dailyPageSource).toContain('<h2 className="df-card-title">Today</h2>');
    expect(dailyPageSource).toContain('<p className="df-card-sub">{page.today.copy}</p>');
    expect(dailyPageSource).toMatch(/page\.today\.rows\.map[\s\S]*?df-settings-row[\s\S]*?df-settings-label/);
    expect(dailyPageSource).not.toContain("page.emptyCopy");
    expect(dailyPageSource).not.toMatch(/<p className="df-empty">/);
    expect(dailyPageSource).toMatch(/<div className="df-form-actions">\s*<Button variant="default" type="submit"[^>]*>\s*Submit/);
  });

  it("already-submitted Workday lists today's records and still allows another Project", () => {
    const page = composeDailyUpdatePage(
      emptyDaily({
        projects: [
          { id: "prj-1", name: "Harbour rebuild" },
          { id: "prj-2", name: "Pier survey" },
        ],
        submissions: [
          {
            id: "du-1",
            crmProjectId: "prj-1",
            status: "on_track",
            whatHappened: "Shipped the import.",
            nextSteps: "Wire the API.",
            waitingOnClient: false,
            crmProject: { project: { name: "Harbour rebuild" } },
          },
        ],
      }),
    );

    expect(page.kind).toBe("submitted");
    expect(page.canSubmit).toBe(true);
    expect(page.submissions).toHaveLength(1);
    expect(page.submissions[0]).toMatchObject({
      id: "du-1",
      project: "Harbour rebuild",
      status: "On Track",
      prose: "Shipped the import.",
      nextPlans: "Wire the API.",
    });
    expect(JSON.stringify(page)).not.toContain("Keystone");
  });

  it("names an internal blockage without calling it waiting on the Client", () => {
    const page = composeDailyUpdatePage(
      emptyDaily({
        submissions: [
          {
            id: "du-block",
            crmProjectId: "prj-1",
            status: "blocked_internal",
            blockageType: "internal",
            waitingOnClient: false,
            crmProject: { project: { name: "Harbour rebuild" } },
          },
        ],
      }),
    );

    expect(page.submissions[0].blocker).toBe("Internal (our team)");
    expect(page.submissions[0].blocker?.toLowerCase()).not.toContain("waiting on the client");
  });

  it("Read-only names the Workspace condition, keeps today's records, and keeps field focus instant", () => {
    const page = composeDailyUpdatePage(
      emptyDaily({
        readOnly: true,
        workspaceName: "Harbor Co",
        submissions: [
          {
            id: "du-ro",
            crmProjectId: "prj-1",
            status: "on_track",
            whatHappened: "Shipped the import.",
            crmProject: { project: { name: "Harbour rebuild" } },
          },
        ],
      }),
    );
    expect(page.kind).toBe("refusal");
    expect(page.canSubmit).toBe(false);
    expect(page.submissions).toHaveLength(1);
    expect(page.submissions[0].project).toBe("Harbour rebuild");
    expect(page.refusal).toContain("read-only");
    expect(page.refusal?.toLowerCase()).not.toContain("permission denied");
    expect(dailyPageSource).toContain("/api/daily-updates");
    expect(dailyPageSource).toContain("POST");
    expect(dailyPageSource).not.toContain("DailyUpdatesAdminPage");
    expect(dailyPageSource).toMatch(/df-daily-field/);
  });
});

describe("Time Entry enter/exit motion (#190)", () => {
  it("bridges add and remove of a Time Entry and keeps reduced motion on opacity", () => {
    const enter = motionForSurface("time-entry");
    expect(enter.enterExit).toBe("standard");
    expect(enter.movement).toBe("allowed");

    const reduced = motionForSurface("time-entry", { reducedMotion: true });
    expect(reduced.movement).toBe("none");
    expect(reduced.keepOpacity).toBe(true);

    expect(rule(".df-time-row[data-motion=\"standard\"]")).toMatch(/var\(--ease-out\)/);
    expect(rule(".df-time-row[data-motion=\"standard\"]")).not.toMatch(/transition\s*:\s*all\b/);
    expect(css).toMatch(/@starting-style[\s\S]*\.df-time-row\[data-motion="standard"\]/);
    expect(pageSource).not.toMatch(/data-motion=\{ENTRY_MOTION\}/);
    expect(pageSource).toMatch(/knownIds/);
    expect(rule('.df-time-row[data-state="leaving"][data-motion="standard"]')).toMatch(/opacity:\s*0/);
    expect(rule(".df-time-clock")).toMatch(/transition:\s*none/);
    expect(css).toMatch(/\.df-daily-field input[\s\S]*?transition:\s*none/);
    expect(reducedMotionCss()).toMatch(/\.df-time-row\[data-motion="standard"\][^{]*\{[^}]*transform:\s*none/);
  });
});

describe("Time stats Workspace Role (#247)", () => {
  it("builds the per-member breakdown when the reader can see everyone", () => {
    const page = composeTimeStats(
      emptyStats({
        canSeeEveryone: true,
        stats: {
          totalDuration: 10800,
          totalIdleTime: 0,
          entriesCount: 2,
          screenshotCount: 0,
          byProject: [{ crmProjectId: "prj-1", projectName: "Harbour rebuild", totalDuration: 10800 }],
          byUser: [
            { userId: "u-2", userName: "Sam Lee", totalDuration: 7200 },
            { userId: "u-1", userName: "Ada Okoro", totalDuration: 3600 },
          ],
        },
      }),
    );
    expect(page.showMembers).toBe(true);
    expect(page.subhead).toBe("Workday totals across Harbor Co, this week.");
    expect(page.byMember.rows).toEqual([
      { id: "u-1", name: "Ada Okoro", hours: "1h 0m", share: null },
      { id: "u-2", name: "Sam Lee", hours: "2h 0m", share: null },
    ]);
  });

  it("hides the breakdown from a Member and does not invent one from byUser", () => {
    const page = composeTimeStats(
      emptyStats({
        canSeeEveryone: false,
        stats: {
          totalDuration: 3600,
          totalIdleTime: 0,
          entriesCount: 1,
          screenshotCount: 0,
          byProject: [{ crmProjectId: "prj-1", projectName: "Harbour rebuild", totalDuration: 3600 }],
          byUser: [{ userId: "me", userName: "Sam Lee", totalDuration: 3600 }],
        },
      }),
    );
    expect(page.showMembers).toBe(false);
    expect(page.byMember.rows).toEqual([]);
    expect(page.subhead).toBe("Your Workday totals in Harbor Co, this week.");
  });

  it("gates the Time MEMBER filter and breakdown on the Workspace Role", () => {
    expect(pageSource).toContain("canManageAdministration");
    expect(pageSource).not.toMatch(/user\?\.role === ["']admin["']/);
  });
});

function emptyStats(overrides: Partial<TimeStatsInput> = {}): TimeStatsInput {
  return {
    period: "week",
    workspaceName: "Harbor Co",
    canSeeEveryone: false,
    stats: null,
    ...overrides,
  };
}

function emptyDaily(overrides: Partial<DailyUpdatePageInput> = {}): DailyUpdatePageInput {
  return {
    now: new Date(2026, 8, 10, 15, 0, 0),
    workspaceName: "Harbor Co",
    readOnly: false,
    projects: [{ id: "prj-1", name: "Harbour rebuild" }],
    submissions: [],
    ...overrides,
  };
}

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`missing rule ${selector}`);
  return match[1];
}

function reducedMotionCss(): string {
  return [...css.matchAll(/@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)\s*\{([\s\S]*?)\n\}/g)]
    .map((match) => match[1])
    .join("\n");
}

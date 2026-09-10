import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { motionForSurface } from "../../client/src/v2/motion";
import { breadcrumbFor, matchV2Route, navIdForPath } from "../../client/src/v2/presentation";
import {
  composeTimeTracking,
  timeEntriesPath,
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
    expect(appSource).toMatch(/path="\/time"/);
    expect(appSource).not.toContain('data-testid="v2-placeholder"');
  });

  it("rewrites v1 /time-tracking URLs here and leaves Devices on the Devices ticket", () => {
    expect(matchV2Route("/time-tracking")).toMatchObject({ kind: "time", href: "/time" });
    expect(matchV2Route("/time-tracking/dashboard")).toMatchObject({ kind: "time", href: "/time" });
    expect(matchV2Route("/time-tracking/projects")).toMatchObject({ kind: "time", href: "/time" });
    expect(matchV2Route("/time-tracking/devices").kind).toBe("placeholder");
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
    expect(pageSource).toMatch(/timeStatsPath\(\{[\s\S]*startDate: startOfDay\(now\)/);
    expect(pageSource).not.toMatch(/timeStatsPath\([\s\S]*rangeDates/);
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
    expect(page.emptyCopy.toLowerCase()).toContain("daily update");
    expect(page.canSubmit).toBe(true);
    expect(page.refusal).toBeNull();
    for (const name of SAMPLE_NAMES) {
      expect(blob).not.toContain(name);
    }
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

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { motionForSurface } from "../../client/src/v2/motion";
import { breadcrumbFor, matchV2Route, navIdForPath } from "../../client/src/v2/presentation";
import {
  composeTimeStats,
  timePeriodRange,
  timeStatsPath,
  timeTabs,
  TIME_PERIODS,
  type TimeStatsInput,
} from "../../client/src/v2/time";
import {
  composeProjectTasks,
  taskPath,
  tasksPath,
  type ProjectTasksInput,
} from "../../client/src/v2/tasks";
import {
  activityTabs,
  composeActivityGallery,
  evidenceDateRange,
  evidenceFileName,
  EVIDENCE_DATE_MODES,
  type ActivityGalleryInput,
} from "../../client/src/v2/activity";

/**
 * Time stats, Projects & Tasks, and the Activity Evidence gallery (#214).
 * Seams: matchV2Route (tabbed Time and Activity destinations) and compose
 * helpers over the existing `/api/time-tracking/stats`,
 * `/api/time-tracking/screenshots*` and `/api/tasks`. No new BFF route.
 * Do not assert hex values, millisecond curves, or the prototype DOM.
 */

const SAMPLE_NAMES = ["Keystone", "Northwind", "Amina", "Kofi", "Elena", "Jules", "Meridian", "Kaleido"];

function read(relative: string): string {
  return readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../..", relative), "utf8");
}

const appSource = read("client/src/v2/V2AuthenticatedApp.tsx");
const timeSource = read("client/src/v2/V2Time.tsx");
const tasksSource = read("client/src/v2/tasks.ts");
const tableSource = read("client/src/v2/V2TaskTable.tsx");
const activitySource = read("client/src/v2/V2Activity.tsx");
const css = read("client/src/v2/tokens.css").replace(/\/\*[\s\S]*?\*\//g, "");

function emptyStats(overrides: Partial<TimeStatsInput> = {}): TimeStatsInput {
  return {
    period: "week",
    workspaceName: "Harbor Co",
    canSeeEveryone: false,
    stats: null,
    ...overrides,
  };
}

function emptyTasks(overrides: Partial<ProjectTasksInput> = {}): ProjectTasksInput {
  return {
    workspaceName: "Harbor Co",
    readOnly: false,
    search: "",
    selectedProjectId: null,
    projects: [],
    tasks: [],
    ...overrides,
  };
}

function emptyGallery(overrides: Partial<ActivityGalleryInput> = {}): ActivityGalleryInput {
  return {
    now: new Date(2026, 8, 10, 15, 0, 0),
    currentUserId: "me",
    canReview: false,
    lowActivityOnly: false,
    identicalOnly: false,
    selectedIds: [],
    expandedId: null,
    page: 1,
    pageSize: 50,
    total: 0,
    projects: [],
    entries: [],
    users: [],
    evidence: [],
    ...overrides,
  };
}

describe("Time Tracking tabs and v1 rewrites (#214)", () => {
  it("keeps Time Entries the default and adds Time stats and Projects & Tasks beside it", () => {
    expect(matchV2Route("/time")).toMatchObject({ kind: "time", href: "/time", tab: "entries" });
    expect(matchV2Route("/time/stats")).toMatchObject({ kind: "time", href: "/time/stats", tab: "stats" });
    expect(matchV2Route("/time/projects")).toMatchObject({
      kind: "time",
      href: "/time/projects",
      tab: "projects",
    });
    expect(navIdForPath("/time/stats")).toBe("time");
    expect(navIdForPath("/time/projects")).toBe("time");
    expect(appSource).toMatch(/path="\/time\/:tab\?"/);
  });

  it("rewrites the v1 Time dashboard and Projects manager onto their v2 tabs", () => {
    expect(matchV2Route("/time-tracking/dashboard")).toMatchObject({
      kind: "time",
      href: "/time/stats",
      tab: "stats",
    });
    expect(matchV2Route("/time-tracking/projects")).toMatchObject({
      kind: "time",
      href: "/time/projects",
      tab: "projects",
    });
    expect(matchV2Route("/time-tracking")).toMatchObject({ kind: "time", href: "/time", tab: "entries" });
    expect(matchV2Route("/time-tracking/devices").kind).toBe("devices");
    expect(JSON.stringify(matchV2Route("/time/stats"))).not.toMatch(/timesheet/i);
  });

  it("names the open tab in the breadcrumb without renaming the destination", () => {
    expect(breadcrumbFor("/time", "Harbor Co").map((crumb) => crumb.label)).toEqual([
      "HARBOR CO",
      "TIME TRACKING",
    ]);
    expect(breadcrumbFor("/time/stats", "Harbor Co").map((crumb) => crumb.label)).toEqual([
      "HARBOR CO",
      "TIME TRACKING",
      "TIME STATS",
    ]);
    expect(breadcrumbFor("/time/projects", "Harbor Co").map((crumb) => crumb.label)).toEqual([
      "HARBOR CO",
      "TIME TRACKING",
      "PROJECTS & TASKS",
    ]);
    expect(breadcrumbFor("/time/stats", "Harbor Co")[1].href).toBe("/time");
    const labels = timeTabs("stats").map((tab) => tab.label);
    expect(labels).toEqual(["Time Entries", "Time stats", "Projects & Tasks"]);
    expect(timeTabs("stats").find((tab) => tab.id === "stats")?.active).toBe(true);
    expect(timeTabs("entries").map((tab) => tab.href)).toEqual(["/time", "/time/stats", "/time/projects"]);
    expect(JSON.stringify(timeTabs("stats")).toLowerCase()).not.toContain("dashboard");
  });
});

describe("Time stats from /api/time-tracking/stats (#214)", () => {
  it("an empty period is honest and never shows sample names or a Timesheet", () => {
    const page = composeTimeStats(emptyStats({ period: "today" }));
    const blob = JSON.stringify(page);

    expect(page.periodLabel).toBe("Today");
    expect(page.byProject.empty).toBe(true);
    expect(page.byMember.empty).toBe(true);
    expect(page.byProject.emptyCopy.toLowerCase()).toContain("today");
    expect(page.figures.map((figure) => figure.value)).toEqual(["0m", "0", "0m", "0m", "0"]);
    for (const name of SAMPLE_NAMES) expect(blob).not.toContain(name);
    expect(blob.toLowerCase()).not.toContain("timesheet");
  });

  it("reports Workday totals, by Project, and by Member without a productivity score", () => {
    const page = composeTimeStats(
      emptyStats({
        period: "week",
        canSeeEveryone: true,
        stats: {
          totalDuration: 10800,
          totalIdleTime: 3600,
          entriesCount: 4,
          screenshotCount: 12,
          byProject: [
            { crmProjectId: "prj-1", projectName: "Harbour rebuild", totalDuration: 7200 },
            { crmProjectId: "prj-2", projectName: "Pier survey", totalDuration: 3600 },
          ],
          byUser: [
            { userId: "u-2", userName: "Sam Lee", totalDuration: 7200 },
            { userId: "u-1", userName: "Ada Okoro", totalDuration: 3600 },
          ],
        },
      }),
    );
    const blob = JSON.stringify(page).toLowerCase();

    expect(page.periodLabel).toBe("This week");
    // A 45-minute average reads as 45m, not as "0.8 h" — the v1 dashboard's resolution.
    expect(page.figures).toEqual([
      { label: "TRACKED", value: "3h 0m", meta: "Active time, idle excluded" },
      { label: "TIME ENTRIES", value: "4", meta: "Recorded intervals" },
      { label: "AVERAGE ENTRY", value: "45m", meta: "Per Time Entry" },
      { label: "IDLE", value: "1h 0m", meta: "Detected idle time" },
      { label: "ACTIVITY EVIDENCE", value: "12", meta: "Captures in this period" },
    ]);

    // Projects carry a share of the period; the leader sorts first.
    expect(page.byProject.rows).toEqual([
      { id: "prj-1", name: "Harbour rebuild", hours: "2h 0m", share: 67 },
      { id: "prj-2", name: "Pier survey", hours: "1h 0m", share: 33 },
    ]);

    // Members are people: alphabetical, hours only, no share and no rank.
    expect(page.byMember.rows).toEqual([
      { id: "u-1", name: "Ada Okoro", hours: "1h 0m", share: null },
      { id: "u-2", name: "Sam Lee", hours: "2h 0m", share: null },
    ]);

    expect(blob).not.toContain("productivity");
    expect(blob).not.toContain("ranking");
    expect(blob).not.toContain("timesheet");
  });

  it("hides the by-Member breakdown from a Member who only sees their own time", () => {
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
    expect(page.subhead.toLowerCase()).toContain("your");
  });

  it("asks the stats BFF for each period it offers", () => {
    const now = new Date(2026, 8, 10, 15, 30, 0);
    expect(TIME_PERIODS).toEqual(["today", "week", "month", "30d", "all"]);
    expect(timePeriodRange("all", now)).toEqual({ startDate: null, endDate: null });
    expect(timePeriodRange("today", now).startDate?.toISOString()).toBe(
      new Date(2026, 8, 10, 0, 0, 0, 0).toISOString(),
    );
    expect(timePeriodRange("week", now).startDate?.getDay()).toBe(1);
    expect(timePeriodRange("month", now).startDate?.getDate()).toBe(1);
    expect(timePeriodRange("30d", now).startDate?.getDate()).toBe(12);

    const path = timeStatsPath({ startDate: new Date(Date.UTC(2026, 8, 10)), crmProjectId: "prj-1" });
    expect(path.startsWith("/api/time-tracking/stats?")).toBe(true);
    expect(decodeURIComponent(path)).toContain("crmProjectId=prj-1");
    expect(timeSource).toContain("/api/time-tracking/stats");
  });
});

describe("Projects & Tasks over /api/tasks (#214)", () => {
  it("asks a Member to choose a Project before it shows a Task list", () => {
    const page = composeProjectTasks(emptyTasks());
    expect(page.projectsEmpty).toBe(true);
    expect(page.selectedProjectName).toBeNull();
    expect(page.chooseCopy.toLowerCase()).toContain("project");
    expect(JSON.stringify(page)).not.toContain("Keystone");
  });

  it("splits a Project's Tasks into open work and Archived, keeping the Dossier's Task Status words", () => {
    const page = composeProjectTasks(
      emptyTasks({
        selectedProjectId: "prj-1",
        projects: [
          { id: "prj-1", project: { name: "Harbour rebuild" }, client: { name: "Harbour Shipping" } },
          { id: "prj-2", project: { name: "Pier survey" } },
        ],
        tasks: [
          { id: "t-1", crmProjectId: "prj-1", name: "Reconcile import", status: "open" },
          { id: "t-2", crmProjectId: "prj-1", name: "Draw the berth", status: "in_progress" },
          { id: "t-3", crmProjectId: "prj-1", name: "Old survey", status: "archived" },
        ],
      }),
    );

    expect(page.selectedProjectName).toBe("Harbour Shipping · Harbour rebuild");
    expect(page.projects.map((project) => project.selected)).toEqual([true, false]);
    expect(page.active.rows).toEqual([
      { id: "t-1", name: "Reconcile import", status: "TO DO", statusValue: "open", archived: false },
      { id: "t-2", name: "Draw the berth", status: "IN PROGRESS", statusValue: "in_progress", archived: false },
    ]);
    expect(page.archived.count).toBe(1);
    expect(page.archived.rows[0]).toMatchObject({ id: "t-3", status: "ARCHIVED", archived: true });
    expect(page.canWrite).toBe(true);
  });

  it("filters the Project list by the search the User typed", () => {
    const page = composeProjectTasks(
      emptyTasks({
        search: "pier",
        projects: [
          { id: "prj-1", project: { name: "Harbour rebuild" } },
          { id: "prj-2", project: { name: "Pier survey" } },
        ],
      }),
    );
    expect(page.projects.map((project) => project.id)).toEqual(["prj-2"]);
  });

  it("a Read-only Workspace names the condition instead of offering a Task write", () => {
    const page = composeProjectTasks(
      emptyTasks({
        readOnly: true,
        selectedProjectId: "prj-1",
        projects: [{ id: "prj-1", project: { name: "Harbour rebuild" } }],
        tasks: [{ id: "t-1", crmProjectId: "prj-1", name: "Reconcile import", status: "open" }],
      }),
    );
    expect(page.canWrite).toBe(false);
    expect(page.refusal).toContain("read-only");
    expect(page.active.rows).toHaveLength(1);
  });

  it("keeps the Dossier Task protocol: the same /api/tasks contract, no second one", () => {
    expect(tasksPath("prj-1")).toBe("/api/tasks?crmProjectId=prj-1");
    expect(tasksPath("prj-1", { includeArchived: true })).toBe(
      "/api/tasks?crmProjectId=prj-1&includeArchived=true",
    );
    expect(taskPath("t-1")).toBe("/api/tasks/t-1");
    expect(timeSource).toContain("/api/tasks");
    expect(timeSource).not.toMatch(/\/api\/time-tracking\/tasks/);
    // One Task protocol: the Dossier reads its Task Status words from here too.
    expect(tasksSource).toContain("export function taskStatusLabel");
    expect(read("client/src/v2/dossier.ts")).toContain('from "./tasks"');
  });
});

describe("Activity Evidence gallery (#214)", () => {
  it("keeps the Activity Evidence register the default and puts the gallery beside it", () => {
    expect(matchV2Route("/activity")).toMatchObject({ kind: "activity", href: "/activity", tab: "register" });
    expect(matchV2Route("/activity/gallery")).toMatchObject({
      kind: "activity",
      href: "/activity/gallery",
      tab: "gallery",
    });
    expect(navIdForPath("/activity/gallery")).toBe("activity");
    expect(breadcrumbFor("/activity/gallery", "Harbor Co").map((crumb) => crumb.label)).toEqual([
      "HARBOR CO",
      "ACTIVITY",
      "GALLERY",
    ]);
    expect(activityTabs("gallery").map((tab) => tab.label)).toEqual(["Evidence", "Gallery"]);
    expect(activityTabs("gallery").map((tab) => tab.href)).toEqual(["/activity", "/activity/gallery"]);
    expect(appSource).toMatch(/path="\/activity\/:tab\?"/);
  });

  it("groups captures by the hour they were taken and names their provenance", () => {
    const page = composeActivityGallery(
      emptyGallery({
        canReview: true,
        projects: [{ id: "prj-1", project: { name: "Harbour rebuild" }, client: { name: "Harbour Shipping" } }],
        entries: [{ id: "te-1", taskId: "t-1", task: { name: "Reconcile import" } }],
        users: [{ id: "u-1", firstName: "Sam", lastName: "Lee", email: "sam@example.com" }],
        evidence: [
          {
            id: "s-1",
            capturedAt: new Date(2026, 8, 10, 9, 15, 0),
            userId: "u-1",
            crmProjectId: "prj-1",
            timeEntryId: "te-1",
            storageKey: "agent-screenshots/s-1.png",
          },
          {
            id: "s-2",
            capturedAt: new Date(2026, 8, 10, 9, 45, 0),
            userId: "u-1",
            crmProjectId: "prj-1",
            timeEntryId: "te-1",
            storageKey: "agent-screenshots/s-2.png",
          },
          {
            id: "s-3",
            capturedAt: new Date(2026, 8, 10, 11, 5, 0),
            userId: "u-1",
            crmProjectId: "prj-1",
            timeEntryId: "te-1",
            storageKey: "web/s-3.png",
          },
        ],
      }),
    );

    expect(page.count).toBe(3);
    expect(page.groups).toHaveLength(2);
    expect(page.groups[0].tiles.map((tile) => tile.id)).toEqual(["s-3"]);
    expect(page.groups[1].tiles.map((tile) => tile.id)).toEqual(["s-1", "s-2"]);
    expect(page.groups[1].hourLabel).toBe("09:00");
    expect(page.groups[1].tiles[0]).toMatchObject({
      project: "Harbour Shipping · Harbour rebuild",
      task: "Reconcile import",
      who: "Sam Lee",
      source: "Desktop Device",
      imageSrc: "/api/time-tracking/screenshots/s-1/image",
    });
    expect(JSON.stringify(page).toLowerCase()).not.toContain("productivity");
  });

  it("keeps the low-activity and identical filters v1 already had", () => {
    const shot = (id: string, overrides: Record<string, unknown> = {}) => ({
      id,
      capturedAt: new Date(2026, 8, 10, 9, 0, 0),
      userId: "me",
      crmProjectId: "prj-1",
      timeEntryId: `te-${id}`,
      storageKey: `agent-screenshots/${id}.png`,
      ...overrides,
    });
    const evidence = [
      shot("s-busy", { entryDuration: 3600, entryIdleTime: 600, contentHash: "aaa" }),
      shot("s-idle", { entryDuration: 600, entryIdleTime: 3600, contentHash: "bbb" }),
      shot("s-twin-a", { entryDuration: 3600, entryIdleTime: 0, contentHash: "ccc" }),
      shot("s-twin-b", { entryDuration: 3600, entryIdleTime: 0, contentHash: "ccc" }),
    ];

    const all = composeActivityGallery(emptyGallery({ evidence }));
    expect(all.count).toBe(4);
    expect(all.identicalCount).toBe(2);

    const low = composeActivityGallery(emptyGallery({ evidence, lowActivityOnly: true }));
    expect(low.groups.flatMap((group) => group.tiles).map((tile) => tile.id)).toEqual(["s-idle"]);

    const twins = composeActivityGallery(emptyGallery({ evidence, identicalOnly: true }));
    expect(twins.groups.flatMap((group) => group.tiles).map((tile) => tile.id)).toEqual([
      "s-twin-a",
      "s-twin-b",
    ]);
    expect(twins.groups.flatMap((group) => group.tiles).every((tile) => tile.identical)).toBe(true);
  });

  it("only offers a batch download once captures are selected, and names each file by its capture", () => {
    const evidence = [
      {
        id: "s-1",
        capturedAt: new Date(2026, 8, 10, 9, 5, 4),
        userId: "me",
        crmProjectId: "prj-1",
        timeEntryId: "te-1",
        storageKey: "agent-screenshots/s-1.png",
      },
    ];
    const none = composeActivityGallery(emptyGallery({ evidence }));
    expect(none.selectedCount).toBe(0);
    expect(none.canBatch).toBe(false);

    const one = composeActivityGallery(emptyGallery({ evidence, selectedIds: ["s-1"] }));
    expect(one.selectedCount).toBe(1);
    expect(one.canBatch).toBe(true);
    expect(one.batchLabel).toBe("Download 1 capture");
    expect(one.groups[0].tiles[0].selected).toBe(true);
    expect(evidenceFileName(new Date(2026, 8, 10, 9, 5, 4))).toBe("activity-evidence-2026-09-10_09-05-04.png");
  });

  it("a Member without the review Capability only sees their own captures", () => {
    const page = composeActivityGallery(
      emptyGallery({
        canReview: false,
        evidence: [
          {
            id: "mine",
            capturedAt: new Date(2026, 8, 10, 9, 0, 0),
            userId: "me",
            crmProjectId: "prj-1",
            timeEntryId: "te-1",
            storageKey: "agent-screenshots/mine.png",
          },
          {
            id: "theirs",
            capturedAt: new Date(2026, 8, 10, 9, 0, 0),
            userId: "someone-else",
            crmProjectId: "prj-1",
            timeEntryId: "te-2",
            storageKey: "agent-screenshots/theirs.png",
          },
        ],
      }),
    );
    expect(page.groups.flatMap((group) => group.tiles).map((tile) => tile.id)).toEqual(["mine"]);
    expect(page.count).toBe(1);
  });

  it("keeps the gallery on the screenshot contract the BFF already serves", () => {
    expect(activitySource).toContain("/api/time-tracking/screenshots");
    expect(activitySource).toContain("/api/time-tracking/tracking-policy");
    expect(activitySource).not.toMatch(/\/api\/v2\//);
  });

  it("keeps v1's date filters: the shared periods, one named day, and a custom span", () => {
    const now = new Date(2026, 8, 10, 15, 0, 0);
    expect(EVIDENCE_DATE_MODES).toEqual(["today", "week", "month", "30d", "all", "day", "custom"]);

    // The five shared periods mean exactly what they mean on Time stats.
    expect(evidenceDateRange("all", now, {})).toEqual({ startDate: null, endDate: null });
    expect(evidenceDateRange("today", now, {}).startDate?.getDate()).toBe(10);

    const day = evidenceDateRange("day", now, { day: "2026-03-24" });
    expect(day.startDate?.getFullYear()).toBe(2026);
    expect(day.startDate?.getMonth()).toBe(2);
    expect(day.startDate?.getDate()).toBe(24);
    expect(day.startDate?.getHours()).toBe(0);
    expect(day.endDate?.getDate()).toBe(24);
    expect(day.endDate?.getHours()).toBe(23);

    const span = evidenceDateRange("custom", now, { from: "2026-03-01", to: "2026-03-31" });
    expect(span.startDate?.getDate()).toBe(1);
    expect(span.endDate?.getDate()).toBe(31);

    // An incomplete span asks for nothing rather than guessing a boundary.
    expect(evidenceDateRange("custom", now, { from: "2026-03-01" })).toEqual({
      startDate: null,
      endDate: null,
    });
    expect(evidenceDateRange("day", now, {})).toEqual({ startDate: null, endDate: null });
  });

  it("says how much of the capture set it is showing instead of silently truncating", () => {
    const evidence = Array.from({ length: 50 }, (_, index) => ({
      id: `s-${index}`,
      capturedAt: new Date(2026, 8, 10, 9, 0, index),
      userId: "me",
      crmProjectId: "prj-1",
      timeEntryId: "te-1",
      storageKey: "agent-screenshots/s.png",
    }));

    const first = composeActivityGallery(emptyGallery({ evidence, total: 214, page: 1, pageSize: 50 }));
    expect(first.paging.label).toBe("Showing 1–50 of 214 captures");
    expect(first.paging.hasPrevious).toBe(false);
    expect(first.paging.hasNext).toBe(true);
    expect(first.paging.pageCount).toBe(5);

    const last = composeActivityGallery(emptyGallery({ evidence, total: 214, page: 5, pageSize: 50 }));
    expect(last.paging.label).toBe("Showing 201–214 of 214 captures");
    expect(last.paging.hasNext).toBe(false);
    expect(last.paging.hasPrevious).toBe(true);

    // One page of captures needs no paging chrome at all.
    const single = composeActivityGallery(emptyGallery({ evidence, total: 50, page: 1, pageSize: 50 }));
    expect(single.paging.pageCount).toBe(1);
    expect(single.paging.hasNext).toBe(false);
  });

  it("opens one capture at full size without leaving the gallery", () => {
    const evidence = [
      {
        id: "s-1",
        capturedAt: new Date(2026, 8, 10, 9, 0, 0),
        userId: "me",
        crmProjectId: "prj-1",
        timeEntryId: "te-1",
        storageKey: "agent-screenshots/s-1.png",
      },
    ];
    const closed = composeActivityGallery(emptyGallery({ evidence }));
    expect(closed.groups[0].tiles[0].expanded).toBe(false);

    const open = composeActivityGallery(emptyGallery({ evidence, expandedId: "s-1" }));
    expect(open.groups[0].tiles[0].expanded).toBe(true);
    expect(activitySource).toContain("setExpandedCaptureId");
  });

  it("never labels one capture as low activity — the filter is a lens, not a verdict", () => {
    const page = composeActivityGallery(
      emptyGallery({
        evidence: [
          {
            id: "s-idle",
            capturedAt: new Date(2026, 8, 10, 9, 0, 0),
            userId: "me",
            crmProjectId: "prj-1",
            timeEntryId: "te-1",
            storageKey: "agent-screenshots/s-idle.png",
            entryDuration: 600,
            entryIdleTime: 3600,
          },
        ],
      }),
    );
    expect(JSON.stringify(page)).not.toMatch(/lowActivity"?\s*:/);
    expect(activitySource).not.toMatch(/>LOW ACTIVITY</);
  });
});

describe("Time and Activity under the v2 visual system (#214)", () => {
  it("bands the stats figures instead of building a KPI card grid", () => {
    // CLAUDE-DESIGN-HANDOFF.md: reject floating KPI cards; no universal card grid.
    expect(rule(".df-stat-band")).toMatch(/flex-wrap:\s*wrap/);
    expect(rule(".df-stat-band")).not.toMatch(/grid-template-columns/);
    expect(timeSource).toContain("df-stat-band");
    expect(timeSource).not.toContain("df-stat-figures");
  });

  it("writes badges in Switzer, keeping mono for what the system recorded", () => {
    // AMENDMENTS.md Amendment 1: stages, statuses, badges and category labels move to Switzer.
    expect(rule(".df-status-word")).toMatch(/var\(--df-font-ui\)/);
    // The new Task Status and Identical badges are vocabulary, so Switzer.
    expect(tableSource).toContain('className="df-status-word"');
    expect(tableSource).not.toContain('className="df-status"');
    expect(activitySource).toContain('className="df-status-word">Identical<');
    expect(activitySource).not.toMatch(/df-mono df-meta">IDENTICAL/);
  });

  it("builds every filter on the shadcn Select, not a bare browser control", () => {
    // v2 reaches for client/src/components/ui/ before any custom control.
    const selectSource = read("client/src/v2/V2Select.tsx");
    expect(selectSource).toContain('from "@/components/ui/select"');
    expect(timeSource).toContain("V2FilterSelect");
    expect(activitySource).toContain("V2FilterSelect");
    expect(timeSource).not.toContain("<select");
    expect(activitySource).not.toContain("<select");

    // Radix refuses an empty option value, so "nothing chosen" is a sentinel.
    expect(selectSource).toContain('export const V2_SELECT_NONE = "none"');
    expect(timeSource).toContain("V2_SELECT_NONE");

    // Radix portals the panel outside .df-v2, so it carries the class itself.
    expect(selectSource).toContain('className="df-v2 df-select-content"');
    expect(rule(".df-v2 .df-select-trigger")).toMatch(/var\(--df-divider\)/);
  });

  it("gives every control in a band the same height", () => {
    // Measured: the search box, Add Task and the row buttons all render 34px.
    const at = css.indexOf(".df-toolbar .df-filter-chip");
    expect(at).toBeGreaterThan(-1);
    const block = css.slice(at, css.indexOf("}", at) + 1);
    for (const control of [".df-filter-chip", ".df-filter-input", ".df-ghost-btn", ".df-ink-btn"]) {
      expect(block).toContain(`.df-toolbar ${control}`);
    }
    expect(block).toMatch(/height:\s*var\(--df-control-h\)/);
  });

  it("gives every control in a filter row the same height", () => {
    // shadcn's trigger carries its own h-9; without this it stands proud of
    // the ink button beside it. Measured at 34px for chip, trigger and button.
    const at = css.indexOf(".df-filter-bar .df-filter-chip");
    expect(at).toBeGreaterThan(-1);
    const block = css.slice(at, css.indexOf("}", at) + 1);
    for (const control of [".df-filter-chip", ".df-filter-input", ".df-ghost-btn", ".df-ink-btn"]) {
      expect(block).toContain(`.df-filter-bar ${control}`);
    }
    expect(block).toMatch(/height:\s*var\(--df-control-h\)/);
    expect(block).toMatch(/align-items:\s*center/);
  });

  it("keeps the system's gutter and radii instead of hand-rolled spacing", () => {
    // The card head and every register row inset at 18px; a band is .df-toolbar.
    expect(rule(".df-card-head")).toMatch(/padding:\s*15px 18px/);
    expect(rule(".df-toolbar")).toMatch(/padding:\s*12px 18px/);
    expect(timeSource).not.toMatch(/style=\{\{ padding/);
    expect(timeSource).toContain('className="df-toolbar" data-align="start"');

    // Radii are 3 / 6 / 8 — nothing off that scale.
    for (const selector of [".df-task-rename"]) {
      const radius = rule(selector).match(/border-radius:\s*(\d+)px/)?.[1];
      expect(["3", "6", "8"]).toContain(radius);
    }
  });

  it("renders Tasks as a sortable table on TanStack Table v9", () => {
    // v9 is not v8: features are opted into, useTable replaces useReactTable,
    // the core row model is automatic, and cells render through FlexRender.
    expect(tableSource).toContain('from "@tanstack/react-table"');
    expect(tableSource).toContain("tableFeatures(");
    expect(tableSource).toContain("useTable(");
    expect(tableSource).toContain("rowSortingFeature");
    expect(tableSource).toContain("createSortedRowModel()");
    expect(tableSource).toContain("table.FlexRender");
    // The comment in that file names the v8 API to explain the difference, so
    // the negative check reads the code rather than the prose above it.
    const tableCode = tableSource.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(tableCode).not.toContain("useReactTable");
    expect(tableCode).not.toContain("getCoreRowModel");

    // Markup is the shadcn Table, wearing the register texture.
    expect(tableSource).toContain('from "@/components/ui/table"');
    expect(rule(".df-v2 .df-table-cell")).toMatch(/padding:\s*15px 18px/);
    expect(rule(".df-v2 .df-table-head")).toMatch(/var\(--df-font-mono\)/);

    // Sorting is keyboard-frequency: it re-renders, it does not animate.
    expect(rule(".df-v2 .df-table-sort")).toMatch(/transition:\s*none/);
    expect(rule(".df-v2 .df-table-sort")).toMatch(/animation:\s*none/);
  });

  it("puts Archived Tasks in the same table, since Task Status already says so", () => {
    const page = composeProjectTasks(
      emptyTasks({
        selectedProjectId: "prj-1",
        projects: [{ id: "prj-1", project: { name: "Harbour rebuild" } }],
        tasks: [
          { id: "t-3", crmProjectId: "prj-1", name: "Old survey", status: "archived" },
          { id: "t-1", crmProjectId: "prj-1", name: "Reconcile import", status: "open" },
        ],
      }),
    );
    // Open work sorts before Archived until a User sorts the table otherwise.
    expect(page.rows.map((row) => row.id)).toEqual(["t-1", "t-3"]);
    expect(page.rows.map((row) => row.archived)).toEqual([false, true]);
    expect(rule('.df-v2 .df-table-row[data-archived="true"] .df-row-title')).toMatch(
      /line-through/,
    );
  });

  it("collapses a Task's secondary actions into one control, not three per row", () => {
    // Three bordered buttons repeated down a register is a wall of controls.
    const menuSource = read("client/src/v2/V2RowMenu.tsx");
    expect(menuSource).toContain('from "@/components/ui/dropdown-menu"');
    expect(tableSource).toContain("V2RowMenu");
    expect(tableSource).toContain('label: "Rename"');
    expect(tableSource).toContain('label: "Archive"');
    expect(tableSource).toContain('label: "Delete", danger: true');

    // Deleting still asks once on the row, so the menu cannot destroy in one click.
    expect(tableSource).toContain("Confirm delete");
    expect(timeSource).toContain("setConfirmDeleteId(null)");

    // Verified in Chrome against the real component: the panel renders on v2
    // tokens (white, 8px radius, no padding, no animation) and its items in
    // Switzer 12.5px, with shadcn's own classes overridden.
    expect(rule(".df-v2.df-row-menu")).toMatch(/animation:\s*none/);
    expect(rule(".df-v2 .df-menu-item")).toMatch(/var\(--df-font-ui\)/);
  });

  it("gives a Task row real controls, not three quiet annotations", () => {
    // df-ghost-link is mono 10px archive-slate — an annotation, not a control.
    expect(topLevelRule(".df-ghost-link")).toMatch(/font-size:\s*10px/);
    expect(tableSource).toContain('className="df-row-actions"');
    expect(tableSource).toContain('className="df-ghost-btn"');
    expect(tableSource).not.toContain('className="df-ghost-link"');
    expect(rule(".df-v2 .df-row-menu-trigger")).toMatch(/flex:\s*none/);
    expect(rule(".df-row-actions")).toMatch(/display:\s*flex/);
    const actionsAt = css.indexOf(".df-row-actions .df-ghost-btn");
    expect(actionsAt).toBeGreaterThan(-1);
    expect(css.slice(actionsAt, css.indexOf("}", actionsAt))).toMatch(
      /height:\s*var\(--df-control-h\)/,
    );
  });

  it("rings the field, not the bare input sitting inside it", () => {
    // CLAUDE-DESIGN-HANDOFF.md: visible 2px amber focus ring with offset.
    // .df-filter-input is a wrapper carrying the border, so ringing the input
    // draws the amber inside the field. Verified with a real Tab in Chrome.
    const ring = topLevelRule('.df-filter-input:has(input:focus-visible)');
    expect(ring).toMatch(/outline:\s*2px solid var\(--df-amber\)/);
    expect(ring).toMatch(/outline-offset:\s*2px/);
    expect(topLevelRule(".df-filter-input input:focus-visible")).toMatch(/outline:\s*none/);

    // The global ring still stands for every control that is its own field.
    expect(topLevelRule(".df-v2 :focus-visible")).toMatch(/outline-offset:\s*2px/);
  });

  it("keeps a selection honest when the filters underneath it change", () => {
    expect(activitySource).toMatch(/useEffect\(\(\) => \{\s*setSelectedIds\(\[\]\);/);
  });
});

describe("Time and Activity on a narrow viewport (#214)", () => {
  it("stacks the Projects & Tasks split and narrows the stats and capture grids", () => {
    expect(mobileRule(".df-task-manager")).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\)/);
    expect(mobileRule(".df-stat-band")).toMatch(/padding/);
    expect(mobileRule(".df-gallery-grid")).toMatch(/grid-template-columns/);
    const at = css.indexOf('.df-v2[data-chrome="mobile"] .df-table-cell');
    expect(at).toBeGreaterThan(-1);
    expect(css.slice(at, css.indexOf("}", at))).toMatch(/padding-left:\s*13px/);
  });
});

describe("Time and Activity motion gate (#214)", () => {
  it("only the Time stats period change carries the novelty, and it is opacity only", () => {
    const period = motionForSurface("time-stats-period");
    expect(period.enterExit).toBe("standard");
    expect(period.movement).toBe("none");
    expect(period.keepOpacity).toBe(true);

    const reduced = motionForSurface("time-stats-period", { reducedMotion: true });
    expect(reduced.movement).toBe("none");
    expect(reduced.keepOpacity).toBe(true);

    expect(rule('.df-time-stats[data-motion="standard"]')).toMatch(/opacity/);
    expect(rule('.df-time-stats[data-motion="standard"]')).not.toMatch(/transform/);
    expect(rule('.df-time-stats[data-motion="standard"]')).not.toMatch(/transition\s*:\s*all\b/);
  });

  it("applying a gallery filter is tens a day, so it does not animate", () => {
    const filter = motionForSurface("activity-gallery-filter");
    expect(filter.enterExit).toBe("none");
    expect(filter.movement).toBe("none");
  });

  it("does not animate ticking seconds, histogram bars, or thumbnail layout", () => {
    expect(rule(".df-time-clock")).toMatch(/transition:\s*none/);
    expect(rule(".df-stat-bar-fill")).toMatch(/transition:\s*none/);
    expect(rule(".df-stat-bar-fill")).toMatch(/animation:\s*none/);
    expect(rule(".df-gallery-grid")).toMatch(/transition:\s*none/);
    expect(rule(".df-gallery-tile img")).toMatch(/transition:\s*none/);
    expect(timeSource).not.toMatch(/setInterval/);
  });
});

/** A rule whose selector starts a line, so a compound rule cannot match first. */
function topLevelRule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`\n${escaped}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`missing top-level rule ${selector}`);
  return match[1];
}

function mobileRule(selector: string): string {
  return rule(`.df-v2[data-chrome="mobile"] ${selector}`);
}

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`missing rule ${selector}`);
  return match[1];
}

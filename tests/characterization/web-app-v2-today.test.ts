import { describe, expect, it } from "vitest";
import { remindToastMessage } from "../../client/src/v2/dailyUpdate";
import { matchV2Route } from "../../client/src/v2/presentation";
import { throwIfResNotOk } from "../../client/src/lib/queryClient";
import { composeToday, mobileProjectMeta, nameInitials, todayCardState, type TodayInput } from "../../client/src/v2/today";

/**
 * Today desktop from live Workspace records (#172).
 * Seam: composeToday — maps existing `/api/*` records onto Today. No BFF.
 * Do not assert hex values or the prototype DOM.
 */

const SAMPLE_NAMES = ["Keystone", "Northwind", "Amina", "Kofi", "Elena", "Jules", "Meridian", "Kaleido"];

function emptyInput(overrides: Partial<TodayInput> = {}): TodayInput {
  return {
    now: new Date(2026, 8, 8, 12, 0, 0),
    currentUserId: "user-1",
    projects: [],
    notifications: [],
    recentDocuments: [],
    users: [],
    todaySecondsByUser: [],
    monthSecondsByProject: [],
    missingDailyUpdates: null,
    trackingUserId: null,
    ...overrides,
  };
}

describe("Today desktop from live Workspace records (#172)", () => {
  it("empty Workspace does not crash and does not show sample names from another Workspace", () => {
    const today = composeToday(emptyInput());
    const blob = JSON.stringify(today);

    expect(today.attention).toEqual([]);
    expect(today.projects).toEqual([]);
    expect(today.knowledge).toEqual([]);
    expect(today.workday.members).toEqual([]);
    expect(today.subhead).toBe("Nothing needs you yet.");
    expect(today.projectsTotal).toBe(0);
    expect(today.workday.openTimerSince).toBeNull();
    for (const name of SAMPLE_NAMES) {
      expect(blob).not.toContain(name);
    }
  });

  it("lists Active Projects from this Workspace and opens the Project Dossier", () => {
    const today = composeToday(
      emptyInput({
        projects: [
          {
            id: "prj-live",
            projectStatus: "active",
            projectType: "one_time",
            budgetedHours: 50,
            actualHours: 31,
            project: { id: "doc-1", name: "Ledger rebuild" },
            client: { name: "Harbor Co" },
            assignee: { firstName: "Sam", lastName: "Lee", email: "sam@example.com" },
          },
          {
            id: "prj-archived",
            projectStatus: "archived",
            projectType: "internal",
            budgetedHours: null,
            actualHours: null,
            project: { id: "doc-2", name: "Old archive" },
            client: null,
            assignee: null,
          },
          {
            id: "prj-planned",
            projectStatus: "planned",
            projectType: "one_time",
            budgetedHours: null,
            actualHours: null,
            project: { id: "doc-3", name: "Not started" },
            client: { name: "Harbor Co" },
            assignee: null,
          },
        ],
        monthSecondsByProject: [{ crmProjectId: "prj-live", totalDuration: 258120 }],
      }),
    );

    expect(today.projects).toHaveLength(1);
    expect(today.projectsTotal).toBe(1);
    const row = today.projects[0];
    expect(row.name).toBe("Ledger rebuild");
    expect(row.clientLabel).toBe("Harbor Co");
    expect(row.status).toBe("ACTIVE");
    expect(row.lead).toBe("Sam Lee");
    expect(row.budgetPercent).toBe(62);
    expect(row.trackedMtd).toBe("71.7 h");
    expect(row.href).toBe("/projects/prj-live");
    expect(matchV2Route(row.href).kind).toBe("dossier");
    expect(JSON.stringify(today.projects)).not.toContain("Keystone");
  });

  it("composes Needs attention from existing records and never invents Timesheets", () => {
    const today = composeToday(
      emptyInput({
        notifications: [
          {
            id: "n1",
            type: "daily_update_reminder",
            message: "Don't forget to submit your daily update.",
            isRead: 0,
            createdAt: new Date(2026, 8, 8, 9, 0, 0),
            crmProjectId: null,
          },
          {
            id: "n2",
            type: "mention",
            message: "Sam mentioned you on Harbor Co",
            isRead: 1,
            createdAt: new Date(2026, 8, 8, 8, 0, 0),
            crmProjectId: "prj-live",
          },
        ],
        missingDailyUpdates: [
          { id: "u2", firstName: "Pat", lastName: "Ng", email: "pat@example.com" },
        ],
      }),
    );

    expect(today.attention.map((row) => row.title).join(" ")).not.toMatch(/timesheet/i);
    expect(today.attention.some((row) => row.kind === "Update")).toBe(true);
    expect(today.attention.some((row) => /Pat Ng/.test(row.title))).toBe(true);
    expect(today.attention.some((row) => row.id === "n2")).toBe(false);
    expect(today.subhead).toBe("2 items need your attention.");

    const submitted = composeToday(
      emptyInput({
        notifications: [
          {
            id: "n3",
            type: "daily_update_submitted",
            message: "Ada submitted a Daily Update for Atlas",
            isRead: 0,
            createdAt: new Date(2026, 8, 8, 17, 41, 0),
            crmProjectId: "prj-live",
            fromUserId: "user-ada",
          },
        ],
      }),
    ).attention.find((row) => row.id === "n3");
    expect(submitted).toMatchObject({
      kind: "Update",
      href: "/daily-updates?member=user-ada&day=2026-09-08",
    });

    const remind = today.attention.find((row) => row.id === "daily-updates-missing");
    expect(remind).toMatchObject({
      kind: "Team",
      meta: "Today",
      cta: "Remind",
      action: "remind",
      state: "open",
      href: "/daily-updates",
    });
    expect(remind?.cta.toLowerCase()).not.toBe("open");
  });

  it("resolves the missing Daily Update row after Remind succeeds", () => {
    const today = composeToday(
      emptyInput({
        missingDailyUpdates: [{ id: "u2", firstName: "Pat", lastName: "Ng", email: "pat@example.com" }],
        dailyUpdateReminded: true,
      }),
    );
    expect(today.attention).toEqual([
      expect.objectContaining({
        id: "daily-updates-missing",
        action: "remind",
        state: "resolved",
        cta: "Reminded",
        meta: "Reminded",
      }),
    ]);
    expect(JSON.stringify(today.attention).toLowerCase()).not.toMatch(/timesheet/);
  });

  it("fills workday and recent knowledge from records the User can access", () => {
    const today = composeToday(
      emptyInput({
        users: [
          { id: "user-1", firstName: "Sam", lastName: "Lee", email: "sam@example.com" },
          { id: "user-2", firstName: "Pat", lastName: "Ng", email: "pat@example.com" },
        ],
        todaySecondsByUser: [
          { userId: "user-1", totalDuration: 14400 },
          { userId: "user-2", totalDuration: 3600 },
        ],
        trackingUserId: "user-1",
        missingDailyUpdates: [{ id: "user-2", firstName: "Pat", lastName: "Ng", email: "pat@example.com" }],
        recentDocuments: [
          { id: "doc-9", title: "Scope notes", updatedAt: new Date(2026, 8, 8, 12, 41, 0), projectId: "doc-1" },
        ],
        projects: [
          {
            id: "prj-live",
            projectStatus: "active",
            projectType: "one_time",
            budgetedHours: null,
            actualHours: null,
            project: { id: "doc-1", name: "Ledger rebuild" },
            client: { name: "Harbor Co" },
            assignee: null,
          },
        ],
      }),
    );

    expect(today.workday.hoursTodayLabel).toBe("5.0 h today");
    expect(today.workday.members).toHaveLength(2);
    expect(today.workday.members[0]).toMatchObject({
      id: "user-1",
      name: "Sam Lee",
      state: "TRACKING",
      hours: "4.0 h",
      self: true,
    });
    expect(today.workday.members[1]).toMatchObject({
      id: "user-2",
      state: "UPDATE MISSING",
      hours: "1.0 h",
      self: false,
    });
    expect(today.knowledge).toEqual([
      {
        id: "doc-9",
        title: "Scope notes",
        meta: "Ledger rebuild",
        when: "12:41",
        href: "/document/doc-9",
      },
    ]);
    expect(matchV2Route(today.knowledge[0].href).kind).toBe("document-editor");
  });

  it("does not invent other members' workday hours the User cannot see", () => {
    const today = composeToday(
      emptyInput({
        users: [
          { id: "user-1", firstName: "Sam", lastName: "Lee", email: "sam@example.com" },
          { id: "user-2", firstName: "Pat", lastName: "Ng", email: "pat@example.com" },
        ],
        todaySecondsByUser: [{ userId: "user-1", totalDuration: 3600 }],
        missingDailyUpdates: null,
      }),
    );
    expect(today.workday.members.map((member) => member.id)).toEqual(["user-1"]);
    expect(today.workday.members[0].hours).toBe("1.0 h");
  });

  it("routes a mention to the Project Dossier and ignores unknown notification kinds", () => {
    const today = composeToday(
      emptyInput({
        notifications: [
          {
            id: "n-mention",
            type: "mention",
            message: "Sam mentioned you on Harbor Co",
            isRead: 0,
            createdAt: new Date(2026, 8, 8, 8, 0, 0),
            crmProjectId: "prj-live",
          },
          {
            id: "n-unknown",
            type: "something_else",
            message: "Ignore me",
            isRead: 0,
            createdAt: new Date(2026, 8, 8, 8, 1, 0),
            crmProjectId: null,
          },
        ],
      }),
    );
    expect(today.attention).toHaveLength(1);
    expect(today.attention[0].href).toBe("/projects/prj-live");
    expect(today.attention[0].kind).toBe("Mention");
  });

  it("caps Needs attention at five rows, keeps the remind row first and the full count", () => {
    const today = composeToday(
      emptyInput({
        missingDailyUpdates: [
          { id: "m-1", firstName: "Sam", lastName: "Lee", email: "sam@example.com" },
          { id: "m-2", firstName: "Ravi", lastName: "Das", email: "ravi@example.com" },
        ],
        notifications: Array.from({ length: 7 }, (_, index) => ({
          id: `n-${index}`,
          type: "mention",
          message: `Mention ${index}`,
          isRead: 0,
          createdAt: new Date(2026, 8, 8, 8, index, 0),
          crmProjectId: "prj-live",
        })),
      }),
    );
    expect(today.attention).toHaveLength(5);
    expect(today.attention[0].id).toBe("daily-updates-missing");
    expect(today.attentionTotal).toBe(8);
    expect(today.subhead).toContain("8 items");
  });

  it("caps Active Projects at five rows, most Tracked MTD first", () => {
    const projects = Array.from({ length: 8 }, (_, index) => ({
      id: `prj-${index}`,
      projectStatus: "active",
      projectType: "one_time",
      budgetedHours: null,
      actualHours: null,
      project: { id: `doc-${index}`, name: `Project ${index}` },
      client: { name: "Harbor Co" },
      assignee: null,
    }));
    const today = composeToday(
      emptyInput({
        projects,
        monthSecondsByProject: projects.map((project, index) => ({
          crmProjectId: project.id,
          totalDuration: 3600 * (index + 1),
        })),
      }),
    );
    expect(today.projects).toHaveLength(5);
    expect(today.projectsTotal).toBe(8);
    expect(today.projects[0].id).toBe("prj-7");
  });

  it("caps Recent knowledge changes at five rows and keeps the full count", () => {
    const today = composeToday(
      emptyInput({
        recentDocuments: Array.from({ length: 7 }, (_, index) => ({
          id: `doc-${index}`,
          title: `Runbook ${index}`,
          updatedAt: new Date(2026, 8, 8, 9, index, 0),
          projectId: "doc-1",
        })),
      }),
    );
    expect(today.knowledge).toHaveLength(5);
    expect(today.knowledgeTotal).toBe(7);
  });
});

const NOW = new Date(2026, 8, 8, 12, 0, 0);
const PAT = { id: "u2", firstName: "Pat", lastName: "Ng", email: "pat@example.com" };
const RAVI = { id: "u3", firstName: "Ravi", lastName: "Das", email: "ravi@example.com" };

function liveProject(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    projectStatus: "active",
    projectType: "one_time",
    budgetedHours: null,
    actualHours: null,
    project: { id: `doc-${id}`, name: `Project ${id}` },
    client: { name: "Harbor Co" },
    assignee: null,
    ...overrides,
  };
}

describe("Today redesign composition (#370)", () => {
  it("rule 1: roll-call row reflects partial and full reminders", () => {
    const partial = composeToday(
      emptyInput({ missingDailyUpdates: [{ ...PAT, remindedToday: true }, RAVI] }),
    ).attention[0];
    expect(partial).toMatchObject({
      id: "daily-updates-missing",
      kind: "Team",
      href: "/daily-updates",
      action: "remind",
      state: "open",
      cta: "Remind",
      meta: "1 of 2 reminded",
    });
    const all = composeToday(
      emptyInput({ missingDailyUpdates: [{ ...PAT, remindedToday: true }, { ...RAVI, remindedToday: true }] }),
    ).attention[0];
    expect(all).toMatchObject({ state: "resolved", cta: "Reminded", meta: "Reminded" });
  });

  it("rule 2: all own Daily Update reminders collapse into one row", () => {
    const today = composeToday(
      emptyInput({
        notifications: [
          { id: "r1", type: "daily_update_reminder", message: "a", isRead: 0, createdAt: new Date(2026, 8, 8, 9, 0, 0) },
          { id: "r2", type: "daily_update_reminder", message: "b", isRead: 0, createdAt: new Date(2026, 8, 8, 10, 30, 0) },
          { id: "r3", type: "daily_update_reminder", message: "c", isRead: 1, createdAt: new Date(2026, 8, 8, 11, 0, 0) },
        ],
      }),
    );
    expect(today.attention).toEqual([
      {
        id: "own-daily-update",
        kind: "Update",
        title: "Submit your Daily Update",
        meta: "10:30",
        href: "/daily-update",
        cta: "Open",
        action: "open",
        state: "open",
      },
    ]);
    expect(today.attentionTotal).toBe(1);
    expect(today.subhead).toBe("One item needs your attention.");
  });

  it("rules 3-4: other notifications sort newest first, fall back to the notifications action, after roll-call and own reminder", () => {
    const today = composeToday(
      emptyInput({
        missingDailyUpdates: [PAT],
        notifications: [
          { id: "old", type: "mention", message: "old", isRead: 0, createdAt: new Date(2026, 8, 8, 8, 0, 0), crmProjectId: "prj-1" },
          { id: "nodate", type: "reminder", message: "nodate", isRead: 0, createdAt: null, crmProjectId: "prj-1" },
          { id: "new", type: "reminder", message: "new", isRead: 0, createdAt: new Date(2026, 8, 8, 11, 0, 0), crmProjectId: null },
          { id: "own", type: "daily_update_reminder", message: "x", isRead: 0, createdAt: new Date(2026, 8, 8, 7, 0, 0) },
        ],
      }),
    );
    expect(today.attention.map((row) => row.id)).toEqual([
      "daily-updates-missing",
      "own-daily-update",
      "new",
      "old",
      "nodate",
    ]);
    expect(today.attention[2]).toMatchObject({ kind: "Reminder", action: "notifications", href: "", cta: "Open" });
    expect(today.attention[3]).toMatchObject({ kind: "Mention", action: "open", href: "/projects/prj-1" });
    expect(today.attentionTotal).toBe(5);
  });

  it("rule 5: the subhead counts items", () => {
    expect(composeToday(emptyInput()).subhead).toBe("Nothing needs you yet.");
    expect(composeToday(emptyInput({ missingDailyUpdates: [PAT] })).subhead).toBe("One item needs your attention.");
  });

  it("rules 6-8: Active Projects keep live statuses with month seconds only", () => {
    const statuses = ["active", "in_review", "on_hold", "completed", "planned"];
    const today = composeToday(
      emptyInput({
        projects: [
          ...statuses.map((status) => liveProject(`s-${status}`, { projectStatus: status })),
          liveProject("zero"),
        ],
        monthSecondsByProject: [
          ...statuses.map((status, index) => ({ crmProjectId: `s-${status}`, totalDuration: 3600 * (index + 1) })),
          { crmProjectId: "zero", totalDuration: 0 },
        ],
      }),
    );
    expect(today.projects.map((row) => row.id)).toEqual(["s-on_hold", "s-in_review", "s-active"]);
    expect(today.projectsTotal).toBe(3);
  });

  it("rules 9-10: client, meta, lead and mobile meta never render a dash", () => {
    const today = composeToday(
      emptyInput({
        projects: [
          liveProject("a", { assignee: { firstName: "Sam", lastName: "Lee", email: "s@x.com" } }),
          liveProject("b", { client: null, projectType: "internal" }),
        ],
        monthSecondsByProject: [
          { crmProjectId: "a", totalDuration: 7200 },
          { crmProjectId: "b", totalDuration: 3600 },
        ],
      }),
    );
    const [a, b] = today.projects;
    expect(a).toMatchObject({ clientLabel: "Harbor Co", meta: "Harbor Co · Client project", lead: "Sam Lee" });
    expect(b).toMatchObject({ clientLabel: null, meta: "Internal", lead: null });
    expect(mobileProjectMeta(a)).toBe("Harbor Co · ACTIVE · 2.0 h");
    expect(mobileProjectMeta(b)).toBe("ACTIVE · 1.0 h");
  });

  it("rule 11: nameInitials", () => {
    expect(nameInitials("sam@example.com")).toBe("S");
    expect(nameInitials("Sam Lee")).toBe("SL");
    expect(nameInitials("amy van der Berg")).toBe("AB");
    expect(nameInitials("Madonna")).toBe("M");
  });

  it("rule 12: Workday sorts the reader first, then missing, tracking, posted, none", () => {
    const user = (id: string, firstName: string) => ({ id, firstName, lastName: "X", email: `${id}@x.com` });
    const today = composeToday(
      emptyInput({
        currentUserId: "me",
        users: [user("posted", "Aa"), user("track", "Bb"), user("miss2", "Zed"), user("miss1", "Amy"), user("me", "Zoe")],
        todaySecondsByUser: [],
        trackingUserId: "track",
        missingDailyUpdates: [
          { id: "miss1", firstName: "Amy", lastName: "X", email: "a@x.com" },
          { id: "miss2", firstName: "Zed", lastName: "X", email: "z@x.com" },
        ],
      }),
    );
    expect(today.workday.members.map((member) => member.id)).toEqual(["me", "miss1", "miss2", "track", "posted"]);
    expect(today.workday.members[0].initials).toBe("ZX");
  });

  it("rule 13: openTimerSince only for a Timer started before today", () => {
    const base = { missingDailyUpdates: null };
    expect(
      composeToday(emptyInput({ ...base, openTimer: { startTime: new Date(2026, 10, 16, 14, 2, 0) }, now: new Date(2026, 10, 17, 9, 0, 0) }))
        .workday.openTimerSince,
    ).toBe("Timer open since 16 Nov 14:02");
    expect(
      composeToday(emptyInput({ ...base, openTimer: { startTime: new Date(2026, 10, 17, 0, 5, 0) }, now: new Date(2026, 10, 17, 9, 0, 0) }))
        .workday.openTimerSince,
    ).toBeNull();
    expect(composeToday(emptyInput({ ...base, openTimer: null })).workday.openTimerSince).toBeNull();
  });

  it("rule 14: knowledge meta names the Project and the author when known", () => {
    const doc = (createdById: string | null) => ({
      id: "d",
      title: "T",
      updatedAt: NOW,
      projectId: "doc-1",
      createdById,
    });
    const users = [{ id: "u-sam", firstName: "Sam", lastName: "Lee", email: "sam@x.com" }];
    const projects = [liveProject("1", { project: { id: "doc-1", name: "Ledger rebuild" } })];
    const meta = (input: Partial<TodayInput>) => composeToday(emptyInput(input)).knowledge[0].meta;
    expect(meta({ recentDocuments: [doc("u-sam")], users, projects })).toBe("Ledger rebuild · by Sam Lee");
    expect(meta({ recentDocuments: [doc(null)], users, projects })).toBe("Ledger rebuild");
    expect(meta({ recentDocuments: [doc("u-sam")], users, projects: [] })).toBe("by Sam Lee");
    expect(meta({ recentDocuments: [doc(null)], users, projects: [] })).toBe("Project doc");
  });

  it("rule 15: the Remind toast says how many were reminded and how many were skipped", () => {
    expect(remindToastMessage({ sent: 1, missing: 1 })).toBe("Reminded 1 member");
    expect(remindToastMessage({ sent: 3, missing: 3 })).toBe("Reminded 3 members");
    expect(remindToastMessage({ sent: 3, missing: 7 })).toBe("Reminded 3 members · 4 already reminded today");
    expect(remindToastMessage({ sent: 0, missing: 7 })).toBe("Everyone missing was already reminded today");
  });
});

describe("Today review fixes after code review (#370)", () => {
  it("shows a card's error over its loading state, and never as its empty line", () => {
    const idle = { isLoading: false, isError: false };
    const loading = { isLoading: true, isError: false };
    const failed = { isLoading: false, isError: true };
    expect(todayCardState([idle, idle])).toEqual({ loading: false, failed: false, ready: true });
    expect(todayCardState([loading, idle])).toEqual({ loading: true, failed: false, ready: false });
    expect(todayCardState([loading, failed])).toEqual({ loading: false, failed: true, ready: false });
  });

  it("turns a failed read into an error carrying the server's message (res.ok)", async () => {
    await expect(
      throwIfResNotOk(new Response(JSON.stringify({ message: "Failed to fetch stats" }), { status: 500 })),
    ).rejects.toThrow("Failed to fetch stats");
    await expect(throwIfResNotOk(new Response("{}", { status: 200 }))).resolves.toBeUndefined();
  });

  it("hides a Project whose month reads 0.0 h even with a few seconds tracked", () => {
    const project = (id: string) => ({
      id,
      projectStatus: "active",
      projectType: "one_time",
      budgetedHours: null,
      actualHours: null,
      project: { id: `doc-${id}`, name: id },
      client: null,
      assignee: null,
    });
    const today = composeToday(
      emptyInput({
        projects: [project("seconds"), project("tenth")],
        monthSecondsByProject: [
          { crmProjectId: "seconds", totalDuration: 120 },
          { crmProjectId: "tenth", totalDuration: 360 },
        ],
      }),
    );
    expect(today.projects.map((row) => row.id)).toEqual(["tenth"]);
    expect(today.projectsTotal).toBe(1);
  });
});

import { describe, expect, it } from "vitest";
import { matchV2Route } from "../../client/src/v2/presentation";
import { composeToday, type TodayInput } from "../../client/src/v2/today";

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
    expect(today.approvals.empty).toBe(true);
    expect(today.approvals.copy.toLowerCase()).toContain("timesheet");
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

    expect(today.attention.some((row) => row.kind === "APPROVAL")).toBe(false);
    expect(today.attention.map((row) => row.title).join(" ")).not.toMatch(/timesheet/i);
    expect(today.attention.some((row) => row.kind === "UPDATE")).toBe(true);
    expect(today.attention.some((row) => /Pat Ng/.test(row.title))).toBe(true);
    expect(today.attention.some((row) => row.id === "n2")).toBe(false);
    expect(today.subhead).toMatch(/need you/i);
    expect(today.approvals.empty).toBe(true);

    const remind = today.attention.find((row) => row.id === "daily-updates-missing");
    expect(remind).toMatchObject({
      kind: "UPDATE",
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
        meta: "REMINDED",
      }),
    ]);
    expect(today.approvals.empty).toBe(true);
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

    expect(today.workday.hoursTodayLabel).toBe("5.0 h TODAY");
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
        meta: "PROJECT DOC · Ledger rebuild",
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
    expect(today.attention[0].kind).toBe("MENTION");
  });
});

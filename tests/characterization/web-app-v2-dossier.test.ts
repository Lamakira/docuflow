import { describe, expect, it } from "vitest";
import { breadcrumbFor, matchV2Route, navIdForPath } from "../../client/src/v2/presentation";
import { composeDossier, type DossierInput } from "../../client/src/v2/dossier";

/**
 * Project Dossier Overview from a Project row (#173).
 * Seams: matchV2Route (flagged app chrome) and composeDossier (existing `/api/*`).
 * Do not assert hex values or the prototype DOM. No new BFF routes.
 */

const SAMPLE_NAMES = ["Keystone", "Northwind", "Amina", "Kofi", "Elena", "Jules", "Meridian", "Kaleido"];

function emptyInput(overrides: Partial<DossierInput> = {}): DossierInput {
  return {
    now: new Date(2026, 8, 8, 12, 41, 0),
    currentUserId: "user-1",
    tab: "overview",
    project: null,
    tasks: [],
    documents: [],
    dailyUpdate: null,
    dailyUpdateCapabilityMiss: false,
    ownerName: "Sam Lee",
    monthSeconds: 0,
    screenshots: [],
    users: [],
    trackingTaskId: null,
    clientActiveProjectCount: 0,
    ...overrides,
  };
}

function liveProject(): NonNullable<DossierInput["project"]> {
  return {
    id: "prj-live",
    projectStatus: "active",
    projectType: "one_time",
    budgetedHours: 120,
    actualHours: 74,
    updatedAt: new Date(2026, 8, 8, 12, 41, 0),
    project: { id: "doc-1", name: "Ledger rebuild" },
    client: {
      id: "cli-1",
      name: "Harbor Co",
      contacts: [
        { id: "c1", name: "Pat Ng", role: "Approver" },
        { id: "c2", name: "Riley Cho", role: "Finance" },
      ],
    },
    assignee: { id: "user-1", firstName: "Sam", lastName: "Lee", email: "sam@example.com" },
    members: [
      { user: { firstName: "Sam", lastName: "Lee", email: "sam@example.com" } },
      { user: { firstName: "Pat", lastName: "Ng", email: "pat@example.com" } },
    ],
  };
}

describe("Project Dossier routing (#173)", () => {
  it("opens a Project row into the Dossier Overview, not a v1 page", () => {
    const match = matchV2Route("/projects/prj-live");
    expect(match.kind).toBe("dossier");
    if (match.kind !== "dossier") return;
    expect(match.projectId).toBe("prj-live");
    expect(match.tab).toBe("overview");
    expect(navIdForPath("/projects/prj-live")).toBe("projects");
    expect(breadcrumbFor("/projects/prj-live", "Harbor Co").map((crumb) => crumb.label)).toEqual([
      "HARBOR CO",
      "PROJECTS",
      "OVERVIEW",
    ]);
  });

  it("keeps remaining Dossier tabs in the same chrome as placeholders, not v1 screens", () => {
    for (const tab of ["tasks", "time", "activity", "updates", "documents", "files", "settings"] as const) {
      const match = matchV2Route(`/projects/prj-live/${tab}`);
      expect(match.kind, tab).toBe("dossier");
      if (match.kind !== "dossier") continue;
      expect(match.projectId).toBe("prj-live");
      expect(match.tab).toBe(tab);
    }
    expect(matchV2Route("/projects").kind).toBe("placeholder");
    expect(matchV2Route("/project/prj-live").kind).toBe("placeholder");
    expect(matchV2Route("/crm/project/1").kind).toBe("placeholder");
  });
});

describe("Project Dossier Overview from live Workspace records (#173)", () => {
  it("empty and missing Projects use empty geometry and never show another Workspace's sample names", () => {
    const empty = composeDossier(emptyInput());
    const missing = composeDossier(emptyInput({ project: null }));
    const blob = JSON.stringify(empty) + JSON.stringify(missing);

    expect(empty.missing).toBe(true);
    expect(empty.identity).toBeNull();
    expect(empty.nextActions.rows).toEqual([]);
    expect(empty.nextActions.empty).toBe(true);
    expect(empty.documents.rows).toEqual([]);
    expect(empty.evidence.tiles).toEqual([]);
    expect(empty.dailyUpdate.kind).toBe("empty");
    expect(missing.missing).toBe(true);
    for (const name of SAMPLE_NAMES) {
      expect(blob).not.toContain(name);
    }
  });

  it("fills the identity header and Overview from this Project in this Workspace", () => {
    const dossier = composeDossier(
      emptyInput({
        project: liveProject(),
        tasks: [
          { id: "t-open", name: "Reconcile import totals", status: "open" },
          { id: "t-done", name: "Export snapshot", status: "done", updatedAt: new Date(2026, 7, 8, 9, 0, 0) },
        ],
        documents: [
          { id: "d1", title: "Scope notes", updatedAt: new Date(2026, 8, 8, 12, 41, 0), projectId: "doc-1" },
        ],
        dailyUpdate: {
          id: "u1",
          whatHappened: "Imported the remaining vendor batches.",
          blockageType: "client",
          waitingOnClient: true,
          updateDate: new Date(2026, 8, 8, 12, 41, 0),
          user: { firstName: "Pat", lastName: "Ng", email: "pat@example.com" },
        },
        monthSeconds: 258120,
        screenshots: [
          {
            id: "s1",
            capturedAt: new Date(2026, 8, 8, 12, 40, 0),
            userId: "user-2",
            deletedAt: null,
          },
        ],
        users: [{ id: "user-2", firstName: "Pat", lastName: "Ng", email: "pat@example.com" }],
        trackingTaskId: "t-open",
        clientActiveProjectCount: 2,
      }),
    );

    expect(dossier.missing).toBe(false);
    expect(dossier.identity).toMatchObject({
      clientLabel: "Harbor Co",
      kindLabel: "CLIENT PROJECT",
      title: "Ledger rebuild",
      status: "ACTIVE",
    });
    expect(dossier.identity?.lead?.name).toBe("Sam Lee");
    expect(dossier.identity?.lead?.self).toBe(true);
    expect(dossier.identity?.team.map((member) => member.name)).toEqual(["Sam Lee", "Pat Ng"]);
    expect(dossier.stats.budgetPercent).toBe(62);
    expect(dossier.stats.trackedMtd).toBe("71.7 h");
    expect(dossier.stats.showFinance).toBe(false);
    expect(dossier.nextActions.openCount).toBe(1);
    expect(dossier.nextActions.blockedCount).toBe(0);
    expect(dossier.nextActions.rows[0]).toMatchObject({
      id: "t-open",
      title: "Reconcile import totals",
      done: false,
      flag: "TIMER RUNNING",
    });
    expect(dossier.nextActions.rows[1].done).toBe(true);
    expect(dossier.dailyUpdate.kind).toBe("record");
    expect(dossier.dailyUpdate.prose).toContain("Imported the remaining vendor batches.");
    expect(dossier.dailyUpdate.blocker).toBeTruthy();
    expect(dossier.documents.rows).toEqual([
      { id: "d1", title: "Scope notes", meta: "12:41" },
    ]);
    expect(dossier.evidence.tiles).toHaveLength(1);
    expect(dossier.evidence.tiles[0].kind).toBe("screenshot");
    expect(dossier.client?.name).toBe("Harbor Co");
    expect(dossier.client?.contacts.map((row) => row.role)).toEqual(["APPROVER", "FINANCE"]);
    expect(JSON.stringify(dossier)).not.toContain("Keystone");
  });

  it("hides Restricted Project Documents and does not invent Keystone library rows", () => {
    const dossier = composeDossier(
      emptyInput({
        project: liveProject(),
        documents: [
          { id: "visible", title: "Scope notes", updatedAt: new Date(2026, 8, 8, 12, 41, 0), access: "workspace" },
          { id: "hidden", title: "Payroll ledger", updatedAt: new Date(2026, 8, 8, 9, 0, 0), access: "restricted" },
        ],
      }),
    );
    expect(dossier.documents.rows.map((row) => row.id)).toEqual(["visible"]);
    expect(JSON.stringify(dossier.documents)).not.toContain("Payroll");
    expect(JSON.stringify(dossier.documents)).not.toContain("Keystone");
  });

  it("names the Capability when a Member cannot read Daily Updates", () => {
    const dossier = composeDossier(
      emptyInput({
        project: liveProject(),
        dailyUpdateCapabilityMiss: true,
        ownerName: "Sam Lee",
      }),
    );
    expect(dossier.dailyUpdate.kind).toBe("refusal");
    expect(dossier.dailyUpdate.copy).toContain("View Daily Updates");
    expect(dossier.dailyUpdate.copy.toLowerCase()).not.toContain("permission denied");
    expect(dossier.dailyUpdate.copy).toContain("Sam Lee");
    expect(dossier.dailyUpdate.copy).toContain("Owner");
  });

  it("marks non-Overview Dossier tabs as v2 placeholders in the same identity chrome", () => {
    const dossier = composeDossier(
      emptyInput({
        tab: "time",
        project: liveProject(),
        tasks: [{ id: "t-open", name: "Reconcile import totals", status: "open" }],
      }),
    );
    expect(dossier.tabIsPlaceholder).toBe(true);
    expect(dossier.tab).toBe("time");
    expect(dossier.identity?.title).toBe("Ledger rebuild");
    expect(dossier.tabs.find((tab) => tab.id === "overview")?.href).toBe("/projects/prj-live");
    expect(dossier.tabs.find((tab) => tab.id === "time")?.href).toBe("/projects/prj-live/time");
    expect(dossier.tabs.find((tab) => tab.id === "tasks")?.count).toBe("1");
  });
});

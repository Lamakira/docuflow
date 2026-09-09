import { describe, expect, it } from "vitest";
import { breadcrumbFor, matchV2Route, navIdForPath } from "../../client/src/v2/presentation";
import { composeProjectRegister, projectVisibleTo, type ProjectRegisterInput } from "../../client/src/v2/projects";

/**
 * Projects live register (#185).
 * Seams: matchV2Route (flagged app chrome) and composeProjectRegister (existing `/api/*`).
 * Do not assert hex values or the prototype DOM. No new BFF routes.
 */

const SAMPLE_NAMES = ["Keystone", "Northwind", "Amina", "Kofi", "Elena", "Jules", "Meridian", "Kaleido"];

function emptyInput(overrides: Partial<ProjectRegisterInput> = {}): ProjectRegisterInput {
  return {
    workspaceName: "Harbor Co",
    projects: [],
    filterQuery: "",
    statusFilter: "all",
    selectedId: null,
    ...overrides,
  };
}

describe("Projects routing (#185)", () => {
  it("shows a live register on the rail Projects destination", () => {
    const match = matchV2Route("/projects");
    expect(match.kind).toBe("projects");
    expect(navIdForPath("/projects")).toBe("projects");
    expect(breadcrumbFor("/projects", "Harbor Co").map((crumb) => crumb.label)).toEqual([
      "HARBOR CO",
      "PROJECTS",
    ]);
  });

  it("rewrites v1 /crm and /project URLs into this destination or the matching Dossier", () => {
    expect(matchV2Route("/crm")).toMatchObject({ kind: "projects", href: "/projects" });
    expect(matchV2Route("/crm/project/new")).toMatchObject({ kind: "projects", href: "/projects" });
    expect(matchV2Route("/crm/project/prj-live")).toMatchObject({
      kind: "dossier",
      projectId: "prj-live",
      tab: "overview",
      href: "/projects",
    });
    expect(matchV2Route("/project/doc-live").kind).not.toBe("placeholder");
    expect(matchV2Route("/project/doc-live").href).toBe("/projects");
    expect(matchV2Route("/crm/client/cli-1").kind).toBe("placeholder");
  });
});

describe("Projects register from live Project rows (#185)", () => {
  it("empty Workspace uses empty geometry and never shows sample names", () => {
    const register = composeProjectRegister(emptyInput());
    const blob = JSON.stringify(register);

    expect(register.empty).toBe(true);
    expect(register.rows).toEqual([]);
    expect(register.emptyCopy.toLowerCase()).toContain("project");
    for (const name of SAMPLE_NAMES) {
      expect(blob).not.toContain(name);
    }
  });

  it("fills the register from Project reads and opens a row on Dossier Overview", () => {
    const register = composeProjectRegister(
      emptyInput({
        projects: [
          {
            id: "prj-live",
            name: "Harbour rebuild",
            clientName: "Harbor Co",
            projectType: "one_time",
            projectStatus: "active",
            leadName: "Sam Lee",
            budgetPercent: 40,
            trackedMtd: "12.0 h",
            visible: true,
          },
          {
            id: "prj-hidden",
            name: "Restricted ledger",
            clientName: "Other",
            projectType: "one_time",
            projectStatus: "active",
            leadName: "Pat Ng",
            budgetPercent: null,
            trackedMtd: "0.0 h",
            visible: false,
          },
        ],
        selectedId: "prj-live",
      }),
    );

    expect(register.empty).toBe(false);
    expect(register.rows).toHaveLength(1);
    expect(register.rows[0]).toMatchObject({
      id: "prj-live",
      name: "Harbour rebuild",
      clientLabel: "Harbor Co",
      status: "ACTIVE",
      lead: "Sam Lee",
      selected: true,
      href: "/projects/prj-live",
    });
    expect(matchV2Route(register.rows[0].href).kind).toBe("dossier");
    expect(JSON.stringify(register)).not.toContain("Restricted ledger");
    expect(JSON.stringify(register)).not.toContain("Keystone");
  });

  it("filters by name without inventing rows", () => {
    const register = composeProjectRegister(
      emptyInput({
        filterQuery: "pier",
        projects: [
          {
            id: "prj-1",
            name: "Pier survey",
            clientName: null,
            projectType: "internal",
            projectStatus: "planned",
            leadName: null,
            budgetPercent: null,
            trackedMtd: "0.0 h",
            visible: true,
          },
          {
            id: "prj-2",
            name: "Harbour rebuild",
            clientName: "Harbor Co",
            projectType: "one_time",
            projectStatus: "active",
            leadName: "Sam Lee",
            budgetPercent: 10,
            trackedMtd: "1.0 h",
            visible: true,
          },
        ],
      }),
    );

    expect(register.rows.map((row) => row.id)).toEqual(["prj-1"]);
    expect(register.rows[0].kindLabel).toBe("INTERNAL");
    expect(register.empty).toBe(false);
  });

  it("hides Projects a Member is not assigned to, and still shows them to an Owner", () => {
    expect(
      projectVisibleTo({
        role: "member",
        userId: "user-1",
        memberIds: ["user-2"],
        assigneeId: null,
      }),
    ).toBe(false);
    expect(
      projectVisibleTo({
        role: "member",
        userId: "user-1",
        memberIds: ["user-1"],
        assigneeId: null,
      }),
    ).toBe(true);
    expect(
      projectVisibleTo({
        role: "owner",
        userId: "user-1",
        memberIds: ["user-2"],
        assigneeId: null,
      }),
    ).toBe(true);
  });
});

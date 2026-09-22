import { describe, expect, it } from "vitest";
import { breadcrumbFor, matchV2Route, navIdForPath } from "../../client/src/v2/presentation";
import { projectStatusFromCombined } from "../../shared/projectLifecycle";
import {
  PROJECT_BOARD_COLUMNS,
  combinedStatusForProjectStatus,
  composeProjectBoard,
  composeProjectRegister,
  projectsAllPath,
  projectsKanbanPath,
  projectVisibleTo,
  type ProjectBoardInput,
  type ProjectRegisterInput,
} from "../../client/src/v2/projects";

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
    expect(matchV2Route("/crm/client/cli-1").kind).toBe("client-record");
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

function emptyBoard(overrides: Partial<ProjectBoardInput> = {}): ProjectBoardInput {
  return {
    workspaceName: "Harbor Co",
    projects: [],
    filterQuery: "",
    changingId: null,
    ...overrides,
  };
}

describe("Projects board (#259)", () => {
  function row(overrides: Partial<ProjectBoardInput["projects"][number]>): ProjectBoardInput["projects"][number] {
    return {
      id: "prj",
      name: "Harbor",
      clientName: "Northwind",
      projectType: "one_time",
      status: "won_in_progress",
      visible: true,
      ...overrides,
    };
  }

  it("reads the unpaginated portfolio the v1 board used", () => {
    expect(projectsAllPath()).toBe("/api/crm/projects/all");
    expect(projectsKanbanPath()).toBe("/api/crm/projects/all-kanban");
  });

  it("draws delivery in five Project Status columns and none of the sales pipeline", () => {
    // ADR-0001: an Opportunity ends won or lost; delivery starts after. The
    // Opportunities screen already draws the sales stages.
    expect(PROJECT_BOARD_COLUMNS.map((column) => column.id)).toEqual([
      "planned",
      "active",
      "in_review",
      "completed",
      "archived",
    ]);
    const board = composeProjectBoard(emptyBoard({ projects: [] }));
    const ids = board.columns.map((column) => column.id);
    for (const sales of ["lead", "discovering_call_completed", "proposal_sent", "follow_up", "in_negotiation", "lost"]) {
      expect(ids).not.toContain(sales);
    }
  });

  it("places a won Project by its Project Status and hides one the reader cannot see", () => {
    const board = composeProjectBoard(
      emptyBoard({
        projects: [
          row({ id: "prj-live", status: "won_in_progress" }),
          row({ id: "prj-hidden", status: "won_completed", visible: false }),
        ],
      }),
    );

    const active = board.columns.find((column) => column.id === "active");
    expect(active?.label).toBe("ACTIVE");
    expect(active?.cards).toEqual([
      {
        id: "prj-live",
        name: "Harbor",
        clientLabel: "Northwind",
        status: "active",
        href: "/projects/prj-live",
        changing: false,
      },
    ]);
    expect(board.columns.flatMap((column) => column.cards).map((card) => card.id)).toEqual(["prj-live"]);
    expect(board.count).toBe(1);
  });

  it("leaves an unwon or lost Opportunity to the Opportunities pipeline", () => {
    const board = composeProjectBoard(
      emptyBoard({
        projects: [
          row({ id: "prj-lead", status: "lead" }),
          row({ id: "prj-negotiating", status: "in_negotiation" }),
          row({ id: "prj-lost", status: "lost" }),
          row({ id: "prj-won", status: "won_not_started" }),
        ],
      }),
    );
    expect(board.columns.flatMap((column) => column.cards).map((card) => card.id)).toEqual(["prj-won"]);
  });

  it("keeps an Internal Project, which never went through a sale", () => {
    const board = composeProjectBoard(
      emptyBoard({ projects: [row({ id: "prj-internal", projectType: "internal", status: "lead", clientName: null })] }),
    );
    expect(board.columns.find((column) => column.id === "planned")?.cards.map((card) => card.id)).toEqual([
      "prj-internal",
    ]);
  });

  it("writes the combined status that reads back as the column it was dropped in", () => {
    // HTTP still writes the combined lifecycle; storage derives Project Status
    // from it. A drop must round-trip, or the card jumps back.
    for (const column of PROJECT_BOARD_COLUMNS) {
      const combined = combinedStatusForProjectStatus(column.id);
      expect(combined.startsWith("won")).toBe(true);
      expect(projectStatusFromCombined(combined)).toBe(column.id);
    }
  });

  it("says when the filter matches nothing", () => {
    const board = composeProjectBoard(
      emptyBoard({ filterQuery: "nope", projects: [row({ id: "prj-live" })] }),
    );

    expect(board.empty).toBe(true);
    expect(board.emptyCopy).toBe("No Projects match this filter.");
    expect(board.count).toBe(0);
  });
});

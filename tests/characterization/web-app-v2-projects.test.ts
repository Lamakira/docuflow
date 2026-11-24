import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { breadcrumbFor, matchV2Route, navIdForPath } from "../../client/src/v2/presentation";
import { isDeliveryProject, projectStatusFromCombined } from "../../shared/projectLifecycle";
import {
  PROJECT_BOARD_COLUMNS,
  combinedStatusForProjectStatus,
  composeProjectBoard,
  composeProjectDatesForm,
  composeProjectRegister,
  EMPTY_PROJECT_BUDGET_DRAFT,
  newProjectPayload,
  projectStatusChoices,
  projectStatusMovable,
  PROJECT_SORTS,
  projectDatesDraft,
  projectsAllPath,
  projectsKanbanPath,
  projectVisibleTo,
  matchesProjectBoardFilters,
  projectDueOverdue,
  PROJECT_CLOSED_PREVIEW,
  PROJECT_STATUS_FILTER_OPTIONS,
  PROJECT_STATUS_OPTIONS,
  type ProjectBoardFilters,
  type ProjectBoardInput,
  type ProjectRegisterInput,
} from "../../client/src/v2/projects";
import { WON_STATUSES, isWonStatus } from "../../shared/projectLifecycle";

/**
 * Projects live register (#185).
 * Seams: matchV2Route (flagged app chrome) and composeProjectRegister (existing `/api/*`).
 * Do not assert hex values or the prototype DOM. No new BFF routes.
 */

const SAMPLE_NAMES = ["Keystone", "Northwind", "Amina", "Kofi", "Elena", "Jules", "Meridian", "Kaleido"];

function emptyInput(overrides: Partial<ProjectRegisterInput> = {}): ProjectRegisterInput {
  return {
    projects: [],
    filterQuery: "",
    statusFilter: "all",
    tagFilter: "all",
    selectedId: null,
    ...overrides,
  };
}

describe("Projects routing (#185)", () => {
  it("shows a live register on the rail Projects destination", () => {
    const match = matchV2Route("/projects");
    expect(match.kind).toBe("projects");
    expect(navIdForPath("/projects")).toBe("projects");
    expect(breadcrumbFor("/projects", "Harbor Co").map((crumb) => crumb.label)).toEqual(["Harbor Co"]);
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
    expect(register.emptyState?.copy.toLowerCase()).toContain("project");
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
            tags: [],
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
            tags: [],
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
            tags: [],
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
            tags: [],
          },
        ],
      }),
    );

    expect(register.rows.map((row) => row.id)).toEqual(["prj-1"]);
    expect(register.rows[0].kindLabel).toBe("Internal");
    expect(register.empty).toBe(false);
  });

  it("hides Projects a Member is not assigned to, and still shows them to an Owner", () => {
    expect(
      projectVisibleTo({
        role: "member",
        userId: "user-1",
        memberIds: ["user-2"],
        assigneeId: null,
        opportunityOwnerId: null,
      }),
    ).toBe(false);
    expect(
      projectVisibleTo({
        role: "member",
        userId: "user-1",
        memberIds: ["user-1"],
        assigneeId: null,
        opportunityOwnerId: null,
      }),
    ).toBe(true);
    expect(
      projectVisibleTo({
        role: "owner",
        userId: "user-1",
        memberIds: ["user-2"],
        assigneeId: null,
        opportunityOwnerId: null,
      }),
    ).toBe(true);
  });

  it("shows a Member the Opportunity they own, as the server does (#310)", () => {
    expect(
      projectVisibleTo({
        role: "member",
        userId: "user-1",
        memberIds: ["user-2"],
        assigneeId: null,
        opportunityOwnerId: "user-1",
      }),
    ).toBe(true);
  });
});

function emptyBoard(overrides: Partial<ProjectBoardInput> = {}): ProjectBoardInput {
  return {
    projects: [],
    filterQuery: "",
    changingId: null,
    ...overrides,
  };
}

describe("Project visibility reads the Workspace Role in any casing", () => {
  it("shows an Owner and an Administrator every Project, as the server spells the Role", () => {
    // /api/memberships answers "Owner"; two callers passed it through as-is and
    // the Owner was treated as a Member.
    for (const role of ["Owner", "owner", "ADMINISTRATOR", "Administrator"]) {
      expect(projectVisibleTo({ role, userId: "u-owner", memberIds: ["u-other"], assigneeId: "u-other" })).toBe(true);
    }
    expect(projectVisibleTo({ role: "MEMBER", userId: "u-me", memberIds: ["u-other"], assigneeId: "u-other" })).toBe(
      false,
    );
  });
});

describe("Projects board (#259)", () => {
  function row(overrides: Partial<ProjectBoardInput["projects"][number]>): ProjectBoardInput["projects"][number] {
    const status = overrides.status ?? "won_in_progress";
    return {
      id: "prj",
      name: "Harbor",
      clientName: "Northwind",
      projectType: "one_time",
      status,
      projectStatus: projectStatusFromCombined(status),
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
        movable: true,
      },
    ]);
    expect(board.columns.flatMap((column) => column.cards).map((card) => card.id)).toEqual(["prj-live"]);
    expect(board.count).toBe(1);
  });

  it("lists exactly the rows the register lists, so the two views never disagree", () => {
    // The toggle switches how the same Projects are drawn, never which ones.
    // The register's page arrives as delivery rows only (`kind=delivery`, F37).
    const rows = [
      row({ id: "prj-lead", status: "lead" }),
      row({ id: "prj-negotiating", status: "in_negotiation" }),
      row({ id: "prj-lost", status: "lost" }),
      row({ id: "prj-won", status: "won_not_started" }),
      row({ id: "prj-noclient", status: "lead", clientName: null }),
      row({ id: "prj-internal", status: "won_in_progress", projectType: "internal", clientName: null }),
      row({ id: "prj-hidden", status: "won_in_progress", visible: false }),
    ];
    const board = composeProjectBoard(emptyBoard({ projects: rows }));
    const register = composeProjectRegister(
      emptyInput({
        projects: rows.filter((item) => isDeliveryProject(item)).map((item) => ({
          id: item.id,
          name: item.name,
          clientName: item.clientName,
          projectType: item.projectType,
          projectStatus: item.projectStatus,
          leadName: null,
          budgetPercent: null,
          trackedMtd: "0.0 h",
          visible: item.visible,
          tags: [],
        })),
      }),
    );
    const onBoard = board.columns.flatMap((column) => column.cards.map((card) => card.id)).sort();
    expect(onBoard).toEqual(register.rows.map((item) => item.id).sort());
    expect(onBoard).toEqual(["prj-internal", "prj-won"]);
  });

  it("draws no open or lost Opportunity: they are sales, on Opportunities only (F37)", () => {
    // Dropping a lead on ACTIVE would win the sale from the delivery board.
    const board = composeProjectBoard(
      emptyBoard({
        projects: [
          row({ id: "prj-lead", status: "follow_up" }),
          row({ id: "prj-lost", status: "lost" }),
          row({ id: "prj-noclient", status: "lead", clientName: null }),
          row({ id: "prj-custom", status: "won_paid" }),
          row({ id: "prj-cancelled", status: "won_cancelled" }),
        ],
      }),
    );
    expect(board.columns.flatMap((column) => column.cards.map((card) => card.id))).toEqual(["prj-cancelled"]);
    expect(board.count).toBe(1);
  });

  it("moves won work and Internal work, Internal read from the type", () => {
    const board = composeProjectBoard(
      emptyBoard({
        projects: [
          row({ id: "prj-internal", status: "won_not_started", projectType: "internal", clientName: null }),
          row({ id: "prj-noclient-won", status: "won_not_started", clientName: null }),
          row({ id: "prj-documented", status: "documented" }),
        ],
      }),
    );
    const planned = board.columns.find((column) => column.id === "planned")?.cards ?? [];
    expect(planned.map((card) => [card.id, card.movable])).toEqual([
      ["prj-internal", true],
      ["prj-noclient-won", true],
      ["prj-documented", false],
    ]);
  });

  it("gives a Project Status with no fixed column one, rather than dropping the card", () => {
    const board = composeProjectBoard(
      emptyBoard({ projects: [row({ id: "prj-held", status: "won_in_progress", projectStatus: "on_hold" })] }),
    );
    expect(board.columns.find((column) => column.id === "on_hold")?.cards.map((card) => card.id)).toEqual([
      "prj-held",
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
    expect(board.emptyState?.copy).toBe("No Projects match your search.");
    expect(board.emptyState?.clearLabel).toBe("Clear search");
    expect(board.emptyState?.kind).toBe("filtered");
    expect(board.count).toBe(0);
  });
});

describe("Projects register: created and due dates (#307)", () => {
  const projectsSource = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2/V2Projects.tsx"),
    "utf8",
  );

  it("shows when each Project was created and when it is due, in full, and orders by both on the server", () => {
    const row = {
      id: "prj-1",
      name: "Pier survey",
      clientName: null,
      projectType: "internal",
      projectStatus: "active",
      leadName: null,
      budgetPercent: null,
      trackedMtd: "0.0 h",
      visible: true,
      tags: [],
    };
    const register = composeProjectRegister(
      emptyInput({
        projects: [
          { ...row, createdAt: "2026-09-29T10:15:00.000Z", dueDate: "2026-10-15T00:00:00.000Z" },
          { ...row, id: "prj-2", name: "Quay audit", createdAt: null, dueDate: null },
        ],
      }),
    );
    expect(register.rows.map((project) => [project.created, project.due])).toEqual([
      ["29 Sep 2026", "15 Oct 2026"],
      ["-", "-"],
    ]);
    expect(PROJECT_SORTS).toEqual(expect.arrayContaining(["created", "due"]));
    expect(projectsSource).toMatch(/projectColumn\.accessor\("created", \{\s*header: "Created"/);
    expect(projectsSource).toMatch(/projectColumn\.accessor\("due", \{\s*header: "Due"/);
  });
});

describe("A Project's start and due dates, set in v2 (#307)", () => {
  it("holds the saved dates as the date pickers do, and sends only what changed", () => {
    const saved = { startDate: "2026-08-01T00:00:00.000Z", dueDate: null };
    expect(projectDatesDraft(saved)).toEqual({ startDate: "2026-08-01", dueDate: "" });
    expect(projectDatesDraft(null)).toEqual({ startDate: "", dueDate: "" });

    expect(composeProjectDatesForm({ startDate: "2026-08-01", dueDate: "2026-10-30" }, saved)).toMatchObject({
      issue: null,
      canSave: true,
      patch: { dueDate: "2026-10-30" },
    });
    expect(composeProjectDatesForm({ startDate: "", dueDate: "" }, saved).patch).toEqual({ startDate: null });
    expect(composeProjectDatesForm(projectDatesDraft(saved), saved)).toMatchObject({ dirty: false, patch: null });
    expect(composeProjectDatesForm({ startDate: "2026-08-01", dueDate: "2026-07-01" }, saved)).toMatchObject({
      canSave: false,
      patch: null,
      issue: "The due date comes before the start date.",
    });
  });

  it("creates a Project with the dates New Project was given", () => {
    const none = EMPTY_PROJECT_BUDGET_DRAFT;
    // An Internal Project at Planned (F38).
    const internal = { projectType: "internal", status: "won_not_started" };
    expect(newProjectPayload("Pier", none, { startDate: "2026-10-01", dueDate: "2026-12-15" })).toEqual({
      name: "Pier",
      ...internal,
      startDate: "2026-10-01",
      dueDate: "2026-12-15",
    });
    expect(newProjectPayload("Pier", none, { startDate: "2026-10-01", dueDate: "" })).toEqual({
      name: "Pier",
      ...internal,
      startDate: "2026-10-01",
    });
    expect(newProjectPayload("Pier", none)).toEqual({ name: "Pier", ...internal });
    expect(newProjectPayload("Pier", none, { startDate: "2026-12-01", dueDate: "2026-10-01" })).toBeNull();
  });
});

describe("Projects view switcher", () => {
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2/V2Projects.tsx"),
    "utf8",
  );
  const css = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2/tokens.css"),
    "utf8",
  );

  it("is a single-select ToggleGroup of LIST and BOARD driven by the view param", () => {
    expect(source).toMatch(/<ToggleGroup\s+type="single"\s+className="df-segment"\s+aria-label="Project view"/);
    expect(source).toContain('value={boardView ? "board" : "list"}');
    expect(source).toMatch(/<ToggleGroupItem value="list" aria-label="List view"[^>]*>\s*LIST\s*</);
    expect(source).toMatch(/<ToggleGroupItem value="board" aria-label="Board view"[^>]*>\s*BOARD\s*</);
    expect(source).not.toContain("REGISTER\n");
    // Re-clicking the active item emits "" and must keep the selection.
    expect(source).toContain("if (!view) return;");
    expect(source).toContain('withView(search, view === "board" ? "board" : null)');
  });

  it("keeps the global button rule from overriding the segment items", () => {
    expect(css).toContain(':not(.df-segment-item)');
    expect(css).toMatch(/\.df-segment-item\[data-state="on"\]/);
  });
});

describe("Project Status from the Dossier header (#368)", () => {
  it("moves won work and Internal work, Internal read from the type, and nothing else (F38)", () => {
    expect(projectStatusMovable({ projectType: "one_time", clientName: "Harbor Co", status: "won_in_progress" })).toBe(true);
    expect(projectStatusMovable({ projectType: "one_time", clientName: "Harbor Co", status: "lead" })).toBe(false);
    expect(projectStatusMovable({ projectType: "one_time", clientName: "Harbor Co", status: "lost" })).toBe(false);
    expect(projectStatusMovable({ projectType: "internal", clientName: "Harbor Co", status: "lead" })).toBe(true);
    // An open sale with no Client is still a sale, not Internal work.
    expect(projectStatusMovable({ projectType: "one_time", clientName: null, status: "lead" })).toBe(false);
    expect(projectStatusMovable({ projectType: "one_time", clientName: null, status: "won_not_started" })).toBe(true);
    // A custom open stage named `won_…` is not a win.
    expect(projectStatusMovable({ projectType: "one_time", clientName: "Harbor Co", status: "won_paid" })).toBe(false);
  });

  it("offers the board's statuses, and On hold only while it is current", () => {
    expect(projectStatusChoices("active").map((o) => o.value)).toEqual(["planned", "active", "in_review", "completed", "archived"]);
    expect(projectStatusChoices("on_hold").map((o) => o.value)).toEqual(["planned", "active", "on_hold", "in_review", "completed", "archived"]);
  });
});

describe("Projects review (F37-F43)", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(here, "../../client/src/v2/V2Projects.tsx"), "utf8");
  const shellSource = readFileSync(join(here, "../../client/src/v2/V2Shell.tsx"), "utf8");
  const css = readFileSync(join(here, "../../client/src/v2/tokens.css"), "utf8");
  const NOW = new Date(2026, 10, 20, 15, 0, 0);
  const NO_FILTERS: ProjectBoardFilters = { status: "all", client: "all", lead: "all", tag: "all", type: "all", due: "all" };

  function boardRow(
    overrides: Partial<ProjectBoardInput["projects"][number]>,
  ): ProjectBoardInput["projects"][number] {
    const status = overrides.status ?? "won_in_progress";
    return {
      id: "prj",
      name: "Harbor",
      clientName: "Northwind",
      projectType: "one_time",
      status,
      projectStatus: projectStatusFromCombined(status),
      visible: true,
      ...overrides,
    };
  }

  it("lists every won combined value, legacy ones included, and never a custom `won_` stage", () => {
    expect([...WON_STATUSES].sort()).toEqual(
      [
        "won",
        "won_cancelled",
        "won_completed",
        "won_in_progress",
        "won_in_review",
        "won_in_review_client",
        "won_in_review_pm",
        "won_not_started",
      ].sort(),
    );
    for (const status of WON_STATUSES) expect(isWonStatus(status)).toBe(true);
    expect(WON_STATUSES).not.toContain("won_paid");
  });

  it("the rail counts delivery rows only", () => {
    expect(shellSource).toContain('fetch("/api/crm/projects?pageSize=1&kind=delivery")');
  });

  it("filters the board with the register's meaning (F40)", () => {
    const rows = [
      boardRow({ id: "a", clientId: "c-1", memberIds: ["u-1", "u-2"], assigneeId: "u-9", tagIds: ["t-1"], dueDate: "2026-11-10T00:00:00.000Z" }),
      boardRow({ id: "b", clientId: "c-2", memberIds: [], assigneeId: "u-2", tagIds: [], projectType: "internal", dueDate: null }),
      boardRow({ id: "c", clientId: "c-1", status: "won_completed", memberIds: ["u-2"], tagIds: ["t-1", "t-2"], dueDate: "2026-11-24T00:00:00.000Z" }),
    ];
    const ids = (filters: Partial<ProjectBoardFilters>) =>
      rows.filter((row) => matchesProjectBoardFilters(row, { ...NO_FILTERS, ...filters }, NOW)).map((row) => row.id);
    expect(ids({})).toEqual(["a", "b", "c"]);
    expect(ids({ status: "completed" })).toEqual(["c"]);
    expect(ids({ client: "c-1" })).toEqual(["a", "c"]);
    // Project manager: the first Project Member, else the assignee.
    expect(ids({ lead: "u-1" })).toEqual(["a"]);
    expect(ids({ lead: "u-2" })).toEqual(["b", "c"]);
    expect(ids({ lead: "u-9" })).toEqual([]);
    expect(ids({ tag: "t-2" })).toEqual(["c"]);
    expect(ids({ type: "internal" })).toEqual(["b"]);
    expect(ids({ due: "overdue" })).toEqual(["a"]);
    expect(ids({ due: "next_7" })).toEqual(["c"]);
    expect(ids({ due: "none" })).toEqual(["b"]);

    const board = composeProjectBoard(emptyBoard({ projects: rows, filters: { ...NO_FILTERS, client: "c-1" }, now: NOW }));
    expect(board.count).toBe(2);
  });

  it("says filters emptied the board, with Clear filters, as the register does", () => {
    const board = composeProjectBoard(
      emptyBoard({ projects: [boardRow({ id: "a", clientId: "c-1" })], filters: { ...NO_FILTERS, client: "c-9" }, now: NOW }),
    );
    expect(board.emptyState).toMatchObject({ kind: "filtered", copy: "No Projects match these filters.", clearLabel: "Clear filters" });
    expect(source).not.toMatch(/\{boardView \? null : \(\s*<>\s*<V2FilterSelect/);
    expect(source).toContain("PROJECT_STATUS_FILTER_OPTIONS");
  });

  it("caps COMPLETED and ARCHIVED at their 10 most recently updated cards, behind Show all", () => {
    const done = Array.from({ length: 12 }, (_, index) =>
      boardRow({
        id: `done-${index}`,
        status: "won_completed",
        updatedAt: new Date(Date.UTC(2026, 9, index + 1)).toISOString(),
      }),
    );
    const active = Array.from({ length: 12 }, (_, index) => boardRow({ id: `live-${index}` }));
    const board = composeProjectBoard(emptyBoard({ projects: [...done, ...active] }));
    const completed = board.columns.find((column) => column.id === "completed")!;
    expect(completed.total).toBe(12);
    expect(completed.hiddenCount).toBe(2);
    expect(completed.cards).toHaveLength(PROJECT_CLOSED_PREVIEW);
    expect(completed.cards[0].id).toBe("done-11");
    const activeColumn = board.columns.find((column) => column.id === "active")!;
    expect(activeColumn.cards).toHaveLength(12);
    expect(activeColumn.hiddenCount).toBe(0);
    expect(board.count).toBe(24);

    const opened = composeProjectBoard(emptyBoard({ projects: done, expandedColumns: new Set(["completed"]) }));
    expect(opened.columns.find((column) => column.id === "completed")!.cards).toHaveLength(12);

    expect(source).toContain("<span className=\"df-count-chip\">{column.total}</span>");
    expect(source).toContain('{column.hiddenCount > 0 ? `Show all ${column.total}` : "Show fewer"}');
  });

  it("makes a card a link that a drag never opens, and toasts a move with Undo", () => {
    expect(source).toMatch(/<a\s+ref=\{provided\.innerRef\}\s+href=\{card\.href\}/);
    expect(source).toContain("role={undefined}");
    expect(source).toContain("event.detail !== 0");
    expect(source).not.toContain("window.open(card.href");
    expect(source).not.toContain("<article");
    expect(source).not.toContain("df-project-card-opportunity");
    expect(css).not.toContain("df-project-card-opportunity");
    expect(source).toContain('data-changing={card.changing ? "true" : "false"}');
    expect(source).toContain("duration: 8000");
    expect(source).toMatch(/action: \{ label: "Undo", onClick: \(\) => moveProject\.mutate\(\{ id, status: previous, previous: status, undo: true \}\) \}/);
    expect(source).toContain("id: `${toastId}-undone`");
  });

  it("marks a passed due date on an open Project, never one due today (F41)", () => {
    expect(projectDueOverdue("2026-11-19T00:00:00.000Z", "active", NOW)).toBe(true);
    expect(projectDueOverdue("2026-11-20T00:00:00.000Z", "active", NOW)).toBe(false);
    expect(projectDueOverdue("2026-11-21T00:00:00.000Z", "planned", NOW)).toBe(false);
    expect(projectDueOverdue("2026-01-01T00:00:00.000Z", "completed", NOW)).toBe(false);
    expect(projectDueOverdue("2026-01-01T00:00:00.000Z", "archived", NOW)).toBe(false);
    expect(projectDueOverdue(null, "active", NOW)).toBe(false);

    const register = composeProjectRegister(
      emptyInput({
        now: NOW,
        projects: [
          {
            id: "late",
            name: "Late",
            clientName: null,
            projectType: "internal",
            projectStatus: "active",
            leadName: null,
            budgetPercent: null,
            trackedMtd: "0.0 h",
            visible: true,
            tags: [],
            dueDate: "2026-11-01T00:00:00.000Z",
          },
        ],
      }),
    );
    expect(register.rows[0].dueOverdue).toBe(true);
    expect(source).toContain('data-overdue={row.original.dueOverdue ? "true" : undefined}');
    expect(css).toMatch(/\.df-project-due\[data-overdue="true"\]\s*\{\s*color: var\(--df-alert-ink\);/);
  });

  it("reads Internal from the type: a won row with no Client is a Client project", () => {
    const base = {
      name: "Row",
      clientName: null,
      projectStatus: "active",
      leadName: null,
      budgetPercent: null,
      trackedMtd: "0.0 h",
      visible: true,
      tags: [],
    };
    const register = composeProjectRegister(
      emptyInput({
        projects: [
          { ...base, id: "internal", projectType: "internal" },
          { ...base, id: "noclient", projectType: "one_time" },
          { ...base, id: "monthly", projectType: "monthly" },
          { ...base, id: "hourly", projectType: "hourly_budget" },
        ],
      }),
    );
    expect(register.rows.map((row) => [row.clientLabel, row.kindLabel])).toEqual([
      ["-", "Internal"],
      ["-", "Client project"],
      ["-", "Monthly"],
      ["-", "Hourly"],
    ]);
  });

  it("hides New Project where it cannot be used, and offers Try again on a failed load (F42)", () => {
    expect(source).toContain("const showNewProject = !readOnly && !emptyWorkspace;");
    expect(source).toContain('testId="v2-projects-load-failed"');
    expect(source).toMatch(/onClick=\{\(\) => \(boardView \? refetchBoard\(\) : refetchRegister\(\)\)\}\s*>\s*Try again/);
    expect(source).not.toContain("Projects in this Workspace could not be loaded.");
  });

  it("New Project says what it makes, and the register's cells sit on the type scale (F43)", () => {
    expect(source).toContain(
      'description="An Internal Project: delivery work no Client pays for, where Tasks and Time Entries hang. A Client Project comes from a won Opportunity."',
    );
    expect(source).not.toMatch(/fontSize: (13\.5|11|12)\b/);
    expect(css).toMatch(/\.df-project-lead\s*\{[^}]*font-size: var\(--df-text-3\)/);
    expect(css).toMatch(/\.df-project-budget-percent\s*\{[^}]*font-size: var\(--df-text-2\)/);
    expect(css).toMatch(/\.df-project-tracked\s*\{[^}]*font-size: var\(--df-text-2\)/);
  });

  it("leaves On hold out of the Status filter, and still names it from a shared link", () => {
    expect(PROJECT_STATUS_FILTER_OPTIONS.map((option) => option.value)).toEqual([
      "planned",
      "active",
      "in_review",
      "completed",
      "archived",
    ]);
    expect(PROJECT_STATUS_OPTIONS.map((option) => option.value)).toContain("on_hold");
  });
});

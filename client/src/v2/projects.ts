import { projectHref } from "./today";

/**
 * Projects register (#185).
 * Novelty: selected-row fill as state indication (Cold Stock). No enter stagger.
 * Do not animate: row mount, filter keystrokes, sort, scrolling.
 */

export type ProjectRegisterRowInput = {
  id: string;
  name: string;
  clientName: string | null;
  projectType: string | null;
  projectStatus: string;
  leadName: string | null;
  budgetPercent: number | null;
  trackedMtd: string;
  visible: boolean;
};

export type ProjectRegisterInput = {
  workspaceName: string;
  projects: ProjectRegisterRowInput[];
  filterQuery: string;
  statusFilter: string;
  selectedId: string | null;
};

export type ProjectRegisterRow = {
  id: string;
  name: string;
  clientLabel: string;
  kindLabel: string;
  status: string;
  lead: string;
  budgetPercent: number | null;
  trackedMtd: string;
  href: string;
  selected: boolean;
};

export type ProjectRegisterModel = {
  subhead: string;
  empty: boolean;
  emptyCopy: string;
  rows: ProjectRegisterRow[];
  count: number;
};

const STATUS_LABEL: Record<string, string> = {
  planned: "PLANNED",
  active: "ACTIVE",
  on_hold: "ON HOLD",
  in_review: "IN REVIEW",
  completed: "COMPLETED",
  archived: "ARCHIVED",
};

function kindLabel(project: ProjectRegisterRowInput): string {
  if (project.projectType === "internal" || !project.clientName) return "INTERNAL";
  if (project.projectType === "monthly") return "MONTHLY";
  if (project.projectType === "hourly_budget") return "HOURLY";
  return "CLIENT PROJECT";
}

function statusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status.replace(/_/g, " ").toUpperCase();
}

function matchesFilter(project: ProjectRegisterRowInput, needle: string, statusFilter: string): boolean {
  if (statusFilter !== "all" && project.projectStatus !== statusFilter) return false;
  if (!needle) return true;
  const haystack = `${project.name} ${project.clientName ?? ""}`.toLowerCase();
  return haystack.includes(needle);
}

export function composeProjectRegister(input: ProjectRegisterInput): ProjectRegisterModel {
  const subhead = `Projects in ${input.workspaceName}.`;
  const needle = input.filterQuery.trim().toLowerCase();
  const rows = input.projects
    .filter((project) => project.visible)
    .filter((project) => matchesFilter(project, needle, input.statusFilter))
    .map((project) => ({
      id: project.id,
      name: project.name || "Untitled Project",
      clientLabel: project.clientName || "—",
      kindLabel: kindLabel(project),
      status: statusLabel(project.projectStatus),
      lead: project.leadName || "—",
      budgetPercent: project.budgetPercent,
      trackedMtd: project.trackedMtd,
      href: projectHref(project.id),
      selected: project.id === input.selectedId,
    }));

  const empty = rows.length === 0;
  return {
    subhead,
    empty,
    emptyCopy: empty
      ? needle || input.statusFilter !== "all"
        ? "No Projects match this filter."
        : "No Projects in this Workspace yet."
      : "",
    rows,
    count: rows.length,
  };
}

/**
 * Portfolio board (#259). A view on the same Projects the register lists.
 * Columns are the combined status v1's Kanban used, so a daily reader still
 * sees where each Project sits. Opportunities keeps the sales pipeline.
 */

export function projectsAllPath(): string {
  return "/api/crm/projects/all";
}

export function projectsKanbanPath(): string {
  return "/api/crm/projects/all-kanban";
}

export const PROJECT_BOARD_COLUMNS: Array<{ id: string; label: string }> = [
  { id: "lead", label: "LEAD" },
  { id: "discovering_call_completed", label: "DISCOVERING CALL" },
  { id: "proposal_sent", label: "PROPOSAL SENT" },
  { id: "follow_up", label: "FOLLOW UP" },
  { id: "in_negotiation", label: "IN NEGOTIATION" },
  { id: "won", label: "WON" },
  { id: "won_not_started", label: "WON - NOT STARTED" },
  { id: "won_in_progress", label: "WON - IN PROGRESS" },
  { id: "won_in_review", label: "WON - IN REVIEW" },
  { id: "won_completed", label: "WON - COMPLETED" },
  { id: "lost", label: "LOST" },
  { id: "won_cancelled", label: "WON - CANCELLED" },
];

export type ProjectBoardRowInput = {
  id: string;
  name: string;
  clientName: string | null;
  status: string;
  visible: boolean;
};

export type ProjectBoardInput = {
  workspaceName: string;
  projects: ProjectBoardRowInput[];
  filterQuery: string;
  changingId: string | null;
};

export type ProjectBoardCard = {
  id: string;
  name: string;
  clientLabel: string;
  status: string;
  href: string;
  changing: boolean;
};

export type ProjectBoardColumn = {
  id: string;
  label: string;
  cards: ProjectBoardCard[];
};

export type ProjectBoardModel = {
  subhead: string;
  empty: boolean;
  emptyCopy: string;
  columns: ProjectBoardColumn[];
  count: number;
};

function boardLabel(status: string): string {
  return (
    PROJECT_BOARD_COLUMNS.find((column) => column.id === status)?.label ??
    status.replace(/_/g, " ").toUpperCase()
  );
}

export function composeProjectBoard(input: ProjectBoardInput): ProjectBoardModel {
  const needle = input.filterQuery.trim().toLowerCase();
  const columns: ProjectBoardColumn[] = PROJECT_BOARD_COLUMNS.map((column) => ({
    id: column.id,
    label: column.label,
    cards: [],
  }));
  const columnById = new Map(columns.map((column) => [column.id, column]));

  for (const project of input.projects) {
    if (!project.visible) continue;
    if (needle) {
      const haystack = `${project.name} ${project.clientName ?? ""}`.toLowerCase();
      if (!haystack.includes(needle)) continue;
    }
    let column = columnById.get(project.status);
    if (!column) {
      column = { id: project.status, label: boardLabel(project.status), cards: [] };
      columns.push(column);
      columnById.set(project.status, column);
    }
    column.cards.push({
      id: project.id,
      name: project.name || "Untitled Project",
      clientLabel: project.clientName?.trim() || "",
      status: project.status,
      href: projectHref(project.id),
      changing: project.id === input.changingId,
    });
  }

  const count = columns.reduce((sum, column) => sum + column.cards.length, 0);
  const empty = count === 0;
  return {
    subhead: `Projects in ${input.workspaceName}.`,
    empty,
    emptyCopy: empty
      ? needle
        ? "No Projects match this filter."
        : "No Projects in this Workspace yet."
      : "",
    columns,
    count,
  };
}

export function projectVisibleTo(input: {
  role: string | null;
  userId: string;
  memberIds: string[];
  assigneeId: string | null;
}): boolean {
  if (input.role === "owner" || input.role === "administrator") return true;
  if (input.memberIds.includes(input.userId)) return true;
  if (input.memberIds.length === 0 && input.assigneeId && input.assigneeId === input.userId) return true;
  return false;
}

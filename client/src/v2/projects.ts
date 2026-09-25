import { projectStatusFromCombined } from "@shared/projectLifecycle";
import { stageColor, stageInk } from "./stageColor";
import { projectStatusColor } from "./palette";
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
  tags: Array<{ id: string; name: string }>;
};

export type ProjectRegisterInput = {
  workspaceName: string;
  projects: ProjectRegisterRowInput[];
  filterQuery: string;
  statusFilter: string;
  /** A Tag id, or `all` (#260). */
  tagFilter: string;
  selectedId: string | null;
};

export type ProjectRegisterRow = {
  id: string;
  name: string;
  clientLabel: string;
  kindLabel: string;
  status: string;
  /** The status's board colour; `swatchStyle` turns it into the badge. */
  statusColor: string;
  lead: string;
  budgetPercent: number | null;
  trackedMtd: string;
  href: string;
  selected: boolean;
  tags: string[];
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

function matchesFilter(
  project: ProjectRegisterRowInput,
  needle: string,
  statusFilter: string,
  tagFilter: string,
): boolean {
  if (statusFilter !== "all" && project.projectStatus !== statusFilter) return false;
  if (tagFilter !== "all" && !project.tags.some((tag) => tag.id === tagFilter)) return false;
  if (!needle) return true;
  const haystack = `${project.name} ${project.clientName ?? ""}`.toLowerCase();
  return haystack.includes(needle);
}

export function composeProjectRegister(input: ProjectRegisterInput): ProjectRegisterModel {
  const subhead = `Projects in ${input.workspaceName}.`;
  const needle = input.filterQuery.trim().toLowerCase();
  const rows = input.projects
    .filter((project) => project.visible)
    .filter((project) => matchesFilter(project, needle, input.statusFilter, input.tagFilter))
    .map((project) => ({
      id: project.id,
      name: project.name || "Untitled Project",
      clientLabel: project.clientName || "—",
      kindLabel: kindLabel(project),
      status: statusLabel(project.projectStatus),
      statusColor: projectStatusColor(project.projectStatus),
      lead: project.leadName || "—",
      budgetPercent: project.budgetPercent,
      trackedMtd: project.trackedMtd,
      href: projectHref(project.id),
      selected: project.id === input.selectedId,
      tags: project.tags.map((tag) => tag.name),
    }));

  const empty = rows.length === 0;
  return {
    subhead,
    empty,
    emptyCopy: empty
      ? needle || input.statusFilter !== "all" || input.tagFilter !== "all"
        ? "No Projects match this filter."
        : "No Projects in this Workspace yet."
      : "",
    rows,
    count: rows.length,
  };
}

/**
 * Delivery board (#259). The same Projects the register lists, grouped by the
 * same Project Status — the toggle changes how they are drawn, never which.
 *
 * v1's Kanban drew the whole combined lifecycle, so its first five columns were
 * the sales pipeline, which v2 already draws on Opportunities. ADR-0001
 * separates the two, and this board follows it for **writes**: an Opportunity
 * that is still open, or lost, sits where the register puts it but does not move
 * from here. Dropping a lead on ACTIVE would win the sale from the delivery
 * board.
 */

export function projectsAllPath(): string {
  return "/api/crm/projects/all";
}

export function projectsKanbanPath(): string {
  return "/api/crm/projects/all-kanban";
}

export const PROJECT_BOARD_COLUMNS: Array<{ id: string; label: string }> = [
  { id: "planned", label: "PLANNED" },
  { id: "active", label: "ACTIVE" },
  { id: "in_review", label: "IN REVIEW" },
  { id: "completed", label: "COMPLETED" },
  { id: "archived", label: "ARCHIVED" },
];

/**
 * HTTP still writes the combined lifecycle, and storage derives Project Status
 * from it (`postgresStorage.ts`). A drop therefore writes the one combined value
 * that reads back as the column it landed in; anything else and the card jumps.
 * `on_hold` has no combined source, so it is not a column.
 */
const COMBINED_FOR_PROJECT_STATUS: Record<string, string> = {
  planned: "won_not_started",
  active: "won_in_progress",
  in_review: "won_in_review",
  completed: "won_completed",
  archived: "won_cancelled",
};

export function combinedStatusForProjectStatus(projectStatus: string): string {
  return COMBINED_FOR_PROJECT_STATUS[projectStatus] ?? "won_not_started";
}

/**
 * Moves from the board. Won work, and Internal work — which never went through a
 * sale. "Internal" is the register's definition, a Project type or no Client at
 * all, so the two views agree on what they call it.
 */
function movesOnBoard(project: { projectType: string | null; clientName: string | null; status: string }): boolean {
  if (project.status.startsWith("won")) return true;
  return project.projectType === "internal" || !project.clientName;
}

export type ProjectBoardRowInput = {
  id: string;
  name: string;
  clientName: string | null;
  projectType: string | null;
  /** The combined lifecycle, as HTTP returns it. What a drop writes. */
  status: string;
  /** What the register groups by, so the board groups by it too. */
  projectStatus: string;
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
  /** False for an Opportunity that is still open, or lost. */
  movable: boolean;
};

export type ProjectBoardColumn = {
  id: string;
  label: string;
  /** The Project Status colour, as a pill over a tint (v1 parity). */
  color: string;
  ink: "light" | "dark";
  cards: ProjectBoardCard[];
};

function boardColumn(id: string, label: string): ProjectBoardColumn {
  const color = stageColor(id);
  return { id, label, color, ink: stageInk(color), cards: [] };
}

export type ProjectBoardModel = {
  subhead: string;
  empty: boolean;
  emptyCopy: string;
  columns: ProjectBoardColumn[];
  count: number;
};

export function composeProjectBoard(input: ProjectBoardInput): ProjectBoardModel {
  const needle = input.filterQuery.trim().toLowerCase();
  const columns: ProjectBoardColumn[] = PROJECT_BOARD_COLUMNS.map((column) => boardColumn(column.id, column.label));
  const columnById = new Map(columns.map((column) => [column.id, column]));

  for (const project of input.projects) {
    if (!project.visible) continue;
    if (needle) {
      const haystack = `${project.name} ${project.clientName ?? ""}`.toLowerCase();
      if (!haystack.includes(needle)) continue;
    }
    const projectStatus = project.projectStatus || projectStatusFromCombined(project.status);
    let column = columnById.get(projectStatus);
    if (!column) {
      // A Project Status with no fixed column (on_hold) still gets one: a card
      // the register lists must never vanish from the board.
      column = boardColumn(projectStatus, projectStatus.replace(/_/g, " ").toUpperCase());
      columns.push(column);
      columnById.set(projectStatus, column);
    }
    column.cards.push({
      id: project.id,
      name: project.name || "Untitled Project",
      clientLabel: project.clientName?.trim() || "",
      status: projectStatus,
      href: projectHref(project.id),
      changing: project.id === input.changingId,
      movable: movesOnBoard(project),
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
  // `/api/memberships` answers "OWNER"; some callers lowercased it and some did
  // not, and an Owner passed through as-is was treated as a Member.
  const role = input.role?.trim().toLowerCase() ?? null;
  if (role === "owner" || role === "administrator") return true;
  if (input.memberIds.includes(input.userId)) return true;
  if (input.memberIds.length === 0 && input.assigneeId && input.assigneeId === input.userId) return true;
  return false;
}

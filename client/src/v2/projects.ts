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

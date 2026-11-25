import { isDeliveryProject, isWonStatus, projectStatusFromCombined } from "@shared/projectLifecycle";
import { stageColor, stagePill } from "./stageColor";
import { projectStatusColor } from "./palette";
import { budgetedHoursTotal, projectHref } from "./today";
import { readPage, readPageSize, writePaging } from "./paging";
import { dateToDay, formatFullDate, utcDay } from "./dates";
import { sentenceCase } from "./text";
import { emptyKindOf, emptyModelOf, type EmptyModel } from "./emptyState";

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
  createdAt?: Date | string | null;
  dueDate?: Date | string | null;
};

export type ProjectRegisterInput = {
  projects: ProjectRegisterRowInput[];
  filterQuery: string;
  statusFilter: string;
  /** A Tag id, or `all` (#260). */
  tagFilter: string;
  selectedId: string | null;
  /**
   * Filters the server already applied, named for the empty state (#275). The
   * rows arrive narrowed, so the three filters above stay `""`/`all` then.
   */
  activeFilters?: string[];
  /** Today, for the overdue mark (F41). */
  now?: Date;
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
  /** When the Project was created and when it is due, in full (#307). */
  created: string;
  due: string;
  /** Due before today and neither Completed nor Archived (F41). */
  dueOverdue: boolean;
  href: string;
  selected: boolean;
  tags: string[];
};

export type ProjectRegisterModel = {
  empty: boolean;
  /** Why the register shows nothing (#325); null while it has rows. */
  emptyState: EmptyModel | null;
  /** Empty because of a filter, so the register offers to clear it. */
  filtered: boolean;
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

/** Internal is the type, not a missing Client: a won row with no Client is a Client project whose Client is missing. */
function kindLabel(project: ProjectRegisterRowInput): string {
  if (project.projectType === "internal") return "Internal";
  if (project.projectType === "monthly") return "Monthly";
  if (project.projectType === "hourly_budget") return "Hourly";
  return "Client project";
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

export const PROJECT_STATUS_OPTIONS = [
  { value: "planned", label: "PLANNED" },
  { value: "active", label: "ACTIVE" },
  { value: "on_hold", label: "ON HOLD" },
  { value: "in_review", label: "IN REVIEW" },
  { value: "completed", label: "COMPLETED" },
  { value: "archived", label: "ARCHIVED" },
];

/**
 * The Status filter's choices on the register and the board: no `on_hold`, which
 * no v2 screen can set (F43). A shared `status=on_hold` link still filters and
 * is still named, through {@link PROJECT_STATUS_OPTIONS}.
 */
export const PROJECT_STATUS_FILTER_OPTIONS = PROJECT_STATUS_OPTIONS.filter((option) => option.value !== "on_hold");

export const PROJECT_TYPE_OPTIONS = [
  { value: "one_time", label: "One-time" },
  { value: "monthly", label: "Monthly" },
  { value: "hourly_budget", label: "Hourly" },
  { value: "internal", label: "Internal" },
];

export const PROJECT_DUE_OPTIONS = [
  { value: "overdue", label: "Overdue" },
  { value: "next_7", label: "Next 7 days" },
  { value: "this_month", label: "This month" },
  { value: "next_month", label: "Next month" },
  { value: "none", label: "No due date" },
];

/**
 * What narrows the Projects register (#275). `all` is no filter; every field
 * lives in the URL so a filtered view can be shared.
 */
export type ProjectRegisterFilters = {
  q: string;
  status: string;
  client: string;
  lead: string;
  tag: string;
  type: string;
  due: string;
  /** A register column the server can order by, or `""` for most recently updated. */
  sort: ProjectSort | "";
  dir: "asc" | "desc";
  page: number;
  pageSize: number;
};

/** The register columns the server orders by (`CRM_PROJECT_SORTS`). PROJECT MANAGER and TRACKED MTD are not among them. */
export const PROJECT_SORTS = ["name", "status", "budget", "created", "due"] as const;
export type ProjectSort = (typeof PROJECT_SORTS)[number];

const FILTER_PARAMS = ["status", "client", "lead", "tag", "type", "due"] as const;

export function readProjectFilters(search: string): ProjectRegisterFilters {
  const params = new URLSearchParams(search);
  const pick = (name: string) => params.get(name)?.trim() || "all";
  return {
    q: params.get("q") ?? "",
    status: pick("status"),
    client: pick("client"),
    lead: pick("lead"),
    tag: pick("tag"),
    type: pick("type"),
    due: pick("due"),
    sort: PROJECT_SORTS.find((sort) => sort === params.get("sort")) ?? "",
    dir: params.get("dir") === "desc" ? "desc" : "asc",
    page: readPage(params),
    pageSize: readPageSize(params),
  };
}

/**
 * The register's query string. Keeps whatever else the URL carries (`view`),
 * and leaves defaults out so a plain register stays `/projects`.
 */
export function writeProjectFilters(search: string, filters: ProjectRegisterFilters): string {
  const params = new URLSearchParams(search);
  if (filters.q.trim()) params.set("q", filters.q);
  else params.delete("q");
  for (const name of FILTER_PARAMS) {
    if (filters[name] !== "all") params.set(name, filters[name]);
    else params.delete(name);
  }
  if (filters.sort) params.set("sort", filters.sort);
  else params.delete("sort");
  if (filters.sort && filters.dir === "desc") params.set("dir", "desc");
  else params.delete("dir");
  writePaging(params, filters.page, filters.pageSize);
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function hasProjectFilters(filters: ProjectRegisterFilters): boolean {
  return Boolean(filters.q.trim()) || FILTER_PARAMS.some((name) => filters[name] !== "all");
}

export function clearProjectFilters(filters: ProjectRegisterFilters): ProjectRegisterFilters {
  return { ...filters, q: "", status: "all", client: "all", lead: "all", tag: "all", type: "all", due: "all", page: 1 };
}

function startOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function endOfDayOf(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate(), 23, 59, 59, 999);
}

/** The due-date bounds a preset stands for, in the reader's local days. */
export function projectDueRange(preset: string, now: Date): { from?: Date; to?: Date; none?: true } | null {
  const today = startOfDay(now);
  switch (preset) {
    case "overdue":
      return { to: new Date(today.getTime() - 1) };
    case "next_7":
      return { from: today, to: endOfDayOf(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 6)) };
    case "this_month":
      return {
        from: new Date(today.getFullYear(), today.getMonth(), 1),
        to: endOfDayOf(new Date(today.getFullYear(), today.getMonth() + 1, 0)),
      };
    case "next_month":
      return {
        from: new Date(today.getFullYear(), today.getMonth() + 1, 1),
        to: endOfDayOf(new Date(today.getFullYear(), today.getMonth() + 2, 0)),
      };
    case "none":
      return { none: true };
    default:
      return null;
  }
}

/**
 * The server page the register shows: `scope=visible` so a Member's page is
 * never short of rows the register would hide, and `kind=delivery` so open and
 * lost sales stay on Opportunities (F37).
 */
export function projectRegisterPath(filters: ProjectRegisterFilters, now: Date): string {
  const params = new URLSearchParams({
    scope: "visible",
    kind: "delivery",
    page: String(filters.page),
    pageSize: String(filters.pageSize),
  });
  if (filters.q.trim()) params.set("search", filters.q.trim());
  if (filters.status !== "all") params.set("projectStatus", filters.status);
  if (filters.client !== "all") params.set("clientId", filters.client);
  if (filters.lead !== "all") params.set("leadId", filters.lead);
  if (filters.tag !== "all") params.set("tagId", filters.tag);
  if (filters.type !== "all") params.set("projectType", filters.type);
  const due = projectDueRange(filters.due, now);
  if (due?.none) params.set("due", "none");
  if (due?.from) params.set("dueFrom", due.from.toISOString());
  if (due?.to) params.set("dueTo", due.to.toISOString());
  if (filters.sort) {
    params.set("sort", filters.sort);
    params.set("dir", filters.dir);
  }
  return `/api/crm/projects?${params.toString()}`;
}

/**
 * Names each filter in force, for the empty state: the reader sees what emptied
 * the register, not a generic "no match".
 */
export function projectFilterLabels(
  filters: ProjectRegisterFilters,
  names: { clients: Map<string, string>; leads: Map<string, string>; tags: Map<string, string> },
): string[] {
  const optionLabel = (options: Array<{ value: string; label: string }>, value: string) =>
    options.find((option) => option.value === value)?.label ?? value.toUpperCase();
  const labels: string[] = [];
  if (filters.q.trim()) labels.push(`“${filters.q.trim()}”`);
  if (filters.status !== "all") labels.push(`Status: ${sentenceCase(optionLabel(PROJECT_STATUS_OPTIONS, filters.status))}`);
  if (filters.client !== "all") labels.push(`Client: ${names.clients.get(filters.client) ?? "-"}`);
  if (filters.lead !== "all") labels.push(`Project manager: ${names.leads.get(filters.lead) ?? "-"}`);
  if (filters.tag !== "all") labels.push(`Tag: ${names.tags.get(filters.tag) ?? "-"}`);
  if (filters.type !== "all") labels.push(`Type: ${optionLabel(PROJECT_TYPE_OPTIONS, filters.type)}`);
  if (filters.due !== "all") labels.push(`Due: ${optionLabel(PROJECT_DUE_OPTIONS, filters.due)}`);
  return labels;
}

const PROJECTS_NONE = {
  title: "Add your first Project",
  copy: "A Project is the delivery work Tasks and Time Entries hang from. Create one to start planning and tracking work.",
};

/**
 * A due date before today, on a Project still open. Due dates are date-only at
 * UTC midnight, so the stored UTC day meets the reader's local today: a Project
 * due today is not overdue.
 */
export function projectDueOverdue(dueDate: Date | string | null | undefined, projectStatus: string, now: Date): boolean {
  if (projectStatus === "completed" || projectStatus === "archived") return false;
  const due = utcDay(dueDate);
  return due !== "" && due < dateToDay(now);
}

export function composeProjectRegister(input: ProjectRegisterInput): ProjectRegisterModel {
  const needle = input.filterQuery.trim().toLowerCase();
  const now = input.now ?? new Date();
  const rows = input.projects
    .filter((project) => project.visible)
    .filter((project) => matchesFilter(project, needle, input.statusFilter, input.tagFilter))
    .map((project) => ({
      id: project.id,
      name: project.name || "Untitled Project",
      clientLabel: project.clientName || "-",
      kindLabel: kindLabel(project),
      status: statusLabel(project.projectStatus),
      statusColor: projectStatusColor(project.projectStatus),
      lead: project.leadName || "-",
      budgetPercent: project.budgetPercent,
      trackedMtd: project.trackedMtd,
      created: formatFullDate(project.createdAt),
      due: formatFullDate(project.dueDate, { dateOnly: true }),
      dueOverdue: projectDueOverdue(project.dueDate, project.projectStatus, now),
      href: projectHref(project.id),
      selected: project.id === input.selectedId,
      tags: project.tags.map((tag) => tag.name),
    }));

  const empty = rows.length === 0;
  const activeFilters = input.activeFilters ?? [];
  const filtered =
    empty && (activeFilters.length > 0 || Boolean(needle) || input.statusFilter !== "all" || input.tagFilter !== "all");
  return {
    empty,
    emptyState: emptyModelOf(emptyKindOf(empty, filtered), "Projects", PROJECTS_NONE, undefined, {
      search: input.filterQuery,
      // A status or Tag narrowed here has no words of its own.
      filters: input.statusFilter === "all" && input.tagFilter === "all" ? activeFilters : undefined,
    }),
    filtered,
    rows,
    count: rows.length,
  };
}

/**
 * Delivery board (#259). The same Projects the register lists, grouped by the
 * same Project Status, narrowed by the same filters — the toggle changes how
 * they are drawn, never which.
 *
 * v1's Kanban drew the whole combined lifecycle, so its first five columns were
 * the sales pipeline, which v2 already draws on Opportunities. ADR-0001
 * separates the two: an Opportunity that is still open, or lost, is not drawn
 * here at all (F37). Dropping a lead on ACTIVE would win the sale from the
 * delivery board.
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

/**
 * The Project Status choices a Dossier can offer: the board's columns. `on_hold`
 * has no combined source, so it cannot be picked; a Project already On hold still
 * shows it as the current value.
 */
export function projectStatusChoices(current: string): Array<{ value: string; label: string }> {
  return PROJECT_STATUS_OPTIONS.filter((option) => option.value !== "on_hold" || current === "on_hold");
}

export function combinedStatusForProjectStatus(projectStatus: string): string {
  return COMBINED_FOR_PROJECT_STATUS[projectStatus] ?? "won_not_started";
}

/**
 * Moves from the board. Won work, and Internal work — which never went through a
 * sale. Internal is the Project type, as the register reads it: a row with no
 * Client is not Internal for that.
 */
export function projectStatusMovable(project: {
  projectType: string | null;
  clientName?: string | null;
  status: string | null | undefined;
}): boolean {
  if (isWonStatus(project.status)) return true;
  return project.projectType === "internal";
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
  isDocumentationOnly?: number | null;
  clientId?: string | null;
  /** Project Members in the order the server returns them (oldest first). */
  memberIds?: string[];
  assigneeId?: string | null;
  tagIds?: string[];
  dueDate?: Date | string | null;
  updatedAt?: Date | string | null;
};

/** The register's filters, minus the search, which the board applies itself. */
export type ProjectBoardFilters = Pick<ProjectRegisterFilters, "status" | "client" | "lead" | "tag" | "type" | "due">;

export type ProjectBoardInput = {
  projects: ProjectBoardRowInput[];
  filterQuery: string;
  /** The active filters in plain words, for the empty state. */
  activeFilters?: string[];
  changingId: string | null;
  filters?: ProjectBoardFilters;
  /** COMPLETED and ARCHIVED columns the reader opened past their first {@link PROJECT_CLOSED_PREVIEW} cards. */
  expandedColumns?: ReadonlySet<string>;
  now?: Date;
};

/** The closed columns, capped to their most recently updated cards as the pipeline caps Won and Lost (F25). */
export const PROJECT_CLOSED_COLUMNS: readonly string[] = ["completed", "archived"];
export const PROJECT_CLOSED_PREVIEW = 10;

function toTime(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const time = (value instanceof Date ? value : new Date(value)).getTime();
  return Number.isNaN(time) ? null : time;
}

/**
 * Whether a board row passes the register's filters, with the register's
 * meaning (`getCrmProjects`): Project Status, Client, Project manager (the first
 * Project Member, else the assignee), any Tag, type, and the due presets.
 */
export function matchesProjectBoardFilters(
  row: ProjectBoardRowInput,
  filters: ProjectBoardFilters,
  now: Date,
): boolean {
  const projectStatus = row.projectStatus || projectStatusFromCombined(row.status);
  if (filters.status !== "all" && projectStatus !== filters.status) return false;
  if (filters.client !== "all" && row.clientId !== filters.client) return false;
  if (filters.lead !== "all" && (row.memberIds?.[0] ?? row.assigneeId ?? null) !== filters.lead) return false;
  if (filters.tag !== "all" && !(row.tagIds ?? []).includes(filters.tag)) return false;
  if (filters.type !== "all" && row.projectType !== filters.type) return false;
  const range = projectDueRange(filters.due, now);
  if (range) {
    const due = toTime(row.dueDate);
    if (range.none) return due === null;
    if (due === null) return false;
    if (range.from && due < range.from.getTime()) return false;
    if (range.to && due > range.to.getTime()) return false;
  }
  return true;
}

function boardFiltersActive(filters: ProjectBoardFilters | undefined): boolean {
  if (!filters) return false;
  return (["status", "client", "lead", "tag", "type", "due"] as const).some((name) => filters[name] !== "all");
}

export type ProjectBoardCard = {
  id: string;
  name: string;
  clientLabel: string;
  status: string;
  href: string;
  changing: boolean;
  /** False for a row the board may not write (a documented row that is not Internal). */
  movable: boolean;
};

export type ProjectBoardColumn = {
  id: string;
  label: string;
  /** The Project Status colour, as a pill over a tint (v1 parity). */
  color: string;
  ink: "light" | "dark";
  cards: ProjectBoardCard[];
  /** Every card the column holds, including those the cap leaves out. */
  total: number;
  /** Cards past the closed column's cap, behind `Show all`. */
  hiddenCount: number;
};

function boardColumn(id: string, label: string): ProjectBoardColumn {
  // The pill's fill steps darker where neither ink clears 4.5:1 (F29).
  const { fill: color, ink } = stagePill(stageColor(id));
  return { id, label, color, ink, cards: [], total: 0, hiddenCount: 0 };
}

export type ProjectBoardModel = {
  empty: boolean;
  emptyState: EmptyModel | null;
  columns: ProjectBoardColumn[];
  count: number;
};

export function composeProjectBoard(input: ProjectBoardInput): ProjectBoardModel {
  const needle = input.filterQuery.trim().toLowerCase();
  const now = input.now ?? new Date();
  const columns: ProjectBoardColumn[] = PROJECT_BOARD_COLUMNS.map((column) => boardColumn(column.id, column.label));
  const columnById = new Map(columns.map((column) => [column.id, column]));
  const updatedAtById = new Map<string, number | null>();

  for (const project of input.projects) {
    if (!project.visible) continue;
    // Open and lost sales are Opportunities, never delivery work (F37).
    if (!isDeliveryProject(project)) continue;
    if (input.filters && !matchesProjectBoardFilters(project, input.filters, now)) continue;
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
      movable: projectStatusMovable(project),
    });
    updatedAtById.set(project.id, toTime(project.updatedAt));
  }

  for (const column of columns) {
    column.total = column.cards.length;
    if (!PROJECT_CLOSED_COLUMNS.includes(column.id)) continue;
    column.cards.sort((a, b) => (updatedAtById.get(b.id) ?? 0) - (updatedAtById.get(a.id) ?? 0));
    const capped =
      !needle && !input.expandedColumns?.has(column.id) && column.cards.length > PROJECT_CLOSED_PREVIEW;
    if (capped) {
      column.hiddenCount = column.cards.length - PROJECT_CLOSED_PREVIEW;
      column.cards = column.cards.slice(0, PROJECT_CLOSED_PREVIEW);
    }
  }

  const count = columns.reduce((sum, column) => sum + column.total, 0);
  const empty = count === 0;
  const filtersActive = boardFiltersActive(input.filters);
  return {
    empty,
    // Filters emptied it: the register's words; the search alone names its text.
    emptyState: emptyModelOf(emptyKindOf(empty, Boolean(needle) || filtersActive), "Projects", PROJECTS_NONE, undefined, {
      search: input.filterQuery,
      searchOnly: !filtersActive,
      filters: input.activeFilters,
    }),
    columns,
    count,
  };
}

export function projectVisibleTo(input: {
  role: string | null;
  userId: string;
  memberIds: string[];
  assigneeId: string | null;
  opportunityOwnerId: string | null;
}): boolean {
  // `/api/memberships` answers "OWNER"; some callers lowercased it and some did
  // not, and an Owner passed through as-is was treated as a Member.
  const role = input.role?.trim().toLowerCase() ?? null;
  if (role === "owner" || role === "administrator") return true;
  if (input.memberIds.includes(input.userId)) return true;
  if (input.memberIds.length === 0 && input.assigneeId && input.assigneeId === input.userId) return true;
  // The server lets the Opportunity Owner reach it too (#310).
  if (input.opportunityOwnerId && input.opportunityOwnerId === input.userId) return true;
  return false;
}

/**
 * A Project's budget (#277) is `budgetedHours` plus `budgetedMinutes`, written
 * through the routes v1's Project page used: `POST /api/crm/projects` and
 * `PATCH /api/crm/projects/:id`. A zero or blank budget is no budget.
 */
export type ProjectBudgetDraft = { hours: string; minutes: string };

export type ProjectBudget = { budgetedHours: number | null; budgetedMinutes: number };

export type ProjectBudgetForm = {
  issue: string | null;
  dirty: boolean;
  canSave: boolean;
  note: string;
  payload: ProjectBudget | null;
};

export const EMPTY_PROJECT_BUDGET_DRAFT: ProjectBudgetDraft = { hours: "", minutes: "" };

const BUDGET_HOURS_MAX = 99_999;

type SavedBudget = { budgetedHours: number | null; budgetedMinutes?: number | null };

function savedBudget(project: SavedBudget | null | undefined): ProjectBudget {
  const hours = Math.max(0, project?.budgetedHours ?? 0);
  const minutes = Math.max(0, project?.budgetedMinutes ?? 0);
  return hours === 0 && minutes === 0
    ? { budgetedHours: null, budgetedMinutes: 0 }
    : { budgetedHours: hours, budgetedMinutes: minutes };
}

export function projectBudgetDraft(project: SavedBudget | null | undefined): ProjectBudgetDraft {
  const budget = savedBudget(project);
  if (budget.budgetedHours == null) return EMPTY_PROJECT_BUDGET_DRAFT;
  return {
    hours: String(budget.budgetedHours),
    minutes: budget.budgetedMinutes > 0 ? String(budget.budgetedMinutes) : "",
  };
}

export function readProjectBudget(
  draft: ProjectBudgetDraft,
): { budget: ProjectBudget; issue: null } | { budget: null; issue: string } {
  const hoursText = draft.hours.trim();
  const minutesText = draft.minutes.trim();
  const whole = /^\d+$/;
  if (hoursText && (!whole.test(hoursText) || Number(hoursText) > BUDGET_HOURS_MAX)) {
    return { budget: null, issue: "Budget hours must be a whole number from 0 to 99,999." };
  }
  if (minutesText && (!whole.test(minutesText) || Number(minutesText) > 59)) {
    return { budget: null, issue: "Budget minutes must be a whole number from 0 to 59." };
  }
  return { budget: savedBudget({ budgetedHours: Number(hoursText || 0), budgetedMinutes: Number(minutesText || 0) }), issue: null };
}

/** Budget used: the Project's tracked time over its budget (F44). The v1 typed `actualHours` is not read. */
export function projectBudgetPercent(project: SavedBudget & { trackedSeconds?: number | null }): number | null {
  const budgeted = budgetedHoursTotal(project);
  // Only Owners and Administrators are sent the tracked total; without it the meter is unknown, not 0%.
  if (project.trackedSeconds == null) return null;
  return budgeted > 0 ? Math.round((project.trackedSeconds / 3600 / budgeted) * 100) : null;
}

export function budgetLabel(project: SavedBudget | null | undefined): string {
  const budget = savedBudget(project);
  if (budget.budgetedHours == null) return "No budget";
  const parts = [
    budget.budgetedHours > 0 ? `${budget.budgetedHours} h` : null,
    budget.budgetedMinutes > 0 ? `${budget.budgetedMinutes} min` : null,
  ].filter(Boolean);
  return parts.join(" ");
}

/** The Dossier Settings budget form: what would be written, and whether it changes anything. */
export function composeBudgetForm(draft: ProjectBudgetDraft, saved: SavedBudget | null | undefined): ProjectBudgetForm {
  const read = readProjectBudget(draft);
  const current = savedBudget(saved);
  if (!read.budget) {
    return { issue: read.issue, dirty: true, canSave: false, note: read.issue, payload: null };
  }
  const dirty =
    read.budget.budgetedHours !== current.budgetedHours || read.budget.budgetedMinutes !== current.budgetedMinutes;
  return {
    issue: null,
    dirty,
    canSave: dirty,
    note: dirty ? "Unsaved changes." : current.budgetedHours == null ? "No budget set." : `Budget ${budgetLabel(current)}.`,
    payload: read.budget,
  };
}

/**
 * A Project's start and due dates as the date pickers hold them (#307):
 * `YYYY-MM-DD`, or `""` while unset. Both are date-only fields stored at UTC
 * midnight, so the UTC day is the one the Project was given.
 */
export type ProjectDatesDraft = { startDate: string; dueDate: string };

export const EMPTY_PROJECT_DATES_DRAFT: ProjectDatesDraft = { startDate: "", dueDate: "" };

type SavedProjectDates = { startDate?: Date | string | null; dueDate?: Date | string | null };

export function projectDatesDraft(saved: SavedProjectDates | null | undefined): ProjectDatesDraft {
  return { startDate: utcDay(saved?.startDate), dueDate: utcDay(saved?.dueDate) };
}

const DUE_BEFORE_START = "The due date comes before the start date.";

/** Why a Project cannot take these dates, or null. */
export function projectDatesIssue(draft: ProjectDatesDraft): string | null {
  return draft.startDate && draft.dueDate && draft.dueDate < draft.startDate ? DUE_BEFORE_START : null;
}

export type ProjectDatesForm = {
  issue: string | null;
  dirty: boolean;
  canSave: boolean;
  /** Only the dates that change, as `PATCH /api/crm/projects/:id` names them; null clears one. */
  patch: { startDate?: string | null; dueDate?: string | null } | null;
};

export function composeProjectDatesForm(draft: ProjectDatesDraft, saved: SavedProjectDates | null | undefined): ProjectDatesForm {
  const issue = projectDatesIssue(draft);
  const current = projectDatesDraft(saved);
  const patch: NonNullable<ProjectDatesForm["patch"]> = {};
  if (draft.startDate !== current.startDate) patch.startDate = draft.startDate || null;
  if (draft.dueDate !== current.dueDate) patch.dueDate = draft.dueDate || null;
  const dirty = Object.keys(patch).length > 0;
  if (issue) return { issue, dirty, canSave: false, patch: null };
  return { issue: null, dirty, canSave: dirty, patch: dirty ? patch : null };
}

/** What New Project posts, an Internal Project at Planned; null while the name is blank, or the budget or the dates do not read. */
export function newProjectPayload(
  name: string,
  draft: ProjectBudgetDraft,
  dates: ProjectDatesDraft = EMPTY_PROJECT_DATES_DRAFT,
): {
  name: string;
  projectType: "internal";
  status: "won_not_started";
  budgetedHours?: number;
  budgetedMinutes?: number;
  startDate?: string;
  dueDate?: string;
} | null {
  const trimmed = name.trim();
  const read = readProjectBudget(draft);
  if (!trimmed || !read.budget || projectDatesIssue(dates)) return null;
  // An Internal Project, Planned (F38): a Client Project only comes from a won Opportunity.
  return {
    name: trimmed,
    projectType: "internal",
    status: "won_not_started",
    ...(read.budget.budgetedHours == null
      ? {}
      : { budgetedHours: read.budget.budgetedHours, budgetedMinutes: read.budget.budgetedMinutes }),
    ...(dates.startDate ? { startDate: dates.startDate } : {}),
    ...(dates.dueDate ? { dueDate: dates.dueDate } : {}),
  };
}

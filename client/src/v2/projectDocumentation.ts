import { chromeRefusal } from "./chrome";
import { readPage, readPageSize, writePaging } from "./paging";
import { memberName } from "./today";
import { projectDocumentHref, type LibraryModel, type LibraryPerson, type LibraryRow } from "./library";

export type ProjectDocumentationProject = {
  id: string;
  documentProjectId: string;
  name: string;
  visible: boolean;
  documentationEnabled: boolean;
  updatedAt?: Date | string | null;
};

export type ProjectDocumentationDocument = {
  id: string;
  title: string;
  projectId: string;
  parentId?: string | null;
  access?: string | null;
  updatedAt?: Date | string | null;
  createdAt?: Date | string | null;
  createdBy?: LibraryPerson | null;
};

export type ProjectDocumentationInput = {
  now: Date;
  workspaceName: string;
  projects: ProjectDocumentationProject[];
  documents: ProjectDocumentationDocument[];
  expandedProjectIds: string[];
  selectedProjectId: string | null;
  filterQuery: string;
  capabilityMiss?: boolean;
  ownerName?: string | null;
  /** Filters the server already applied, named for the empty state (#275). */
  activeFilters?: string[];
};

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

export function composeProjectDocumentation(input: ProjectDocumentationInput): LibraryModel {
  const subhead = `Project Documents in ${input.workspaceName} — visible to Members assigned to that Project.`;
  if (input.capabilityMiss) {
    return {
      subhead,
      empty: true,
      emptyCopy: "",
      refusal: chromeRefusal({
        kind: "capability",
        capability: "View Project Documents",
        ownerName: input.ownerName ?? null,
      }),
      rows: [],
      folderCount: 0,
      parentNoun: { singular: "PROJECT", plural: "PROJECTS" },
      itemCount: 0,
      preview: null,
    };
  }
  const needle = input.filterQuery.trim().toLowerCase();
  const expanded = new Set(input.expandedProjectIds);
  // The server decides which Projects the page holds, documentation off included
  // when the DOCUMENTATION filter asks for them (#275).
  const visibleProjects = input.projects.filter((project) => project.visible);
  const allowedProjectIds = new Set(visibleProjects.map((project) => project.documentProjectId));
  const visibleDocs = input.documents.filter(
    (document) => allowedProjectIds.has(document.projectId) && isVisibleDocument(document.access),
  );
  const childrenByProject = new Map<string, ProjectDocumentationDocument[]>();
  for (const document of visibleDocs) {
    const list = childrenByProject.get(document.projectId) ?? [];
    list.push(document);
    childrenByProject.set(document.projectId, list);
  }

  const rows: LibraryRow[] = [];
  for (const project of visibleProjects) {
    const children = childrenByProject.get(project.documentProjectId) ?? [];
    const folderMatches = nameMatches(project.name, needle);
    const matchingChildren = needle
      ? children.filter((document) => nameMatches(document.title, needle))
      : children;
    if (needle && !folderMatches && matchingChildren.length === 0) continue;

    const showChildren = expanded.has(project.id) || (Boolean(needle) && matchingChildren.length > 0);
    const listedChildren = needle && !folderMatches ? matchingChildren : matchingChildren;
    rows.push(projectRow(project, children, showChildren, project.id === input.selectedProjectId, input.now));
    for (const document of listedChildren) {
      rows.push(documentRow(document, project.name, input.now));
    }
  }

  const empty = rows.length === 0;
  const activeFilters = input.activeFilters ?? [];
  return {
    subhead,
    empty,
    emptyCopy: empty
      ? activeFilters.length > 0
        ? `No Projects match ${activeFilters.join(" · ")}.`
        : needle
          ? "No Project Documents match this filter."
          : "No Project Documents you can access."
      : "",
    filtered: empty && (activeFilters.length > 0 || Boolean(needle)),
    refusal: null,
    rows,
    folderCount: visibleProjects.length,
    parentNoun: { singular: "PROJECT", plural: "PROJECTS" },
    itemCount: visibleDocs.length + visibleProjects.length,
    preview: null,
  };
}

function isVisibleDocument(access: string | null | undefined): boolean {
  const value = (access ?? "workspace").toLowerCase();
  return value === "workspace" || value === "everyone";
}

function nameMatches(name: string, needle: string): boolean {
  if (!needle) return true;
  return name.toLowerCase().includes(needle);
}

function projectRow(
  project: ProjectDocumentationProject,
  children: ProjectDocumentationDocument[],
  expanded: boolean,
  selected: boolean,
  now: Date,
): LibraryRow {
  const latest = [...children].sort((a, b) => timestamp(b) - timestamp(a))[0];
  const count = children.length;
  const itemLabel = count === 1 ? "1 ITEM" : `${count} ITEMS`;
  return {
    id: project.id,
    // `kind` is the row's shape in the register — an expandable parent. `type`
    // is the word the reader gets, and this row is a Project (#245, F4).
    kind: "folder",
    name: project.name,
    path: project.documentationEnabled ? `/ · ${itemLabel}` : `/ · ${itemLabel} · DOCUMENTATION OFF`,
    type: "PROJECT",
    access: "ASSIGNED",
    editor: latest?.createdBy ? memberName(latest.createdBy) : "—",
    updated: formatWhen(latest?.updatedAt ?? latest?.createdAt ?? project.updatedAt ?? null, now),
    child: false,
    depth: 0,
    expanded,
    selected,
  };
}

function documentRow(document: ProjectDocumentationDocument, projectName: string, now: Date): LibraryRow {
  return {
    id: document.id,
    kind: "document",
    name: document.title,
    path: `${projectName} /`,
    type: "DOCUMENT",
    access: "ASSIGNED",
    editor: document.createdBy ? memberName(document.createdBy) : "—",
    updated: formatWhen(document.updatedAt ?? document.createdAt ?? null, now),
    child: true,
    depth: 1,
    href: projectDocumentHref(document.id),
  };
}

function timestamp(document: ProjectDocumentationDocument): number {
  const value = parseDate(document.updatedAt ?? document.createdAt ?? null);
  return value ? value.getTime() : 0;
}

function parseDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatClock(value: Date): string {
  return `${value.getHours().toString().padStart(2, "0")}:${value.getMinutes().toString().padStart(2, "0")}`;
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function formatWhen(updatedAt: Date | string | null, now: Date): string {
  const value = parseDate(updatedAt);
  if (!value) return "";
  if (sameDay(value, now)) return formatClock(value);
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (sameDay(value, yesterday)) return "YDA";
  return `${value.getDate()} ${MONTHS[value.getMonth()]}`;
}

export const DOCUMENTATION_OPTIONS = [
  { value: "enabled", label: "ENABLED" },
  { value: "disabled", label: "DISABLED" },
  { value: "all", label: "ALL" },
];

export type DocumentationSetting = "enabled" | "disabled" | "all";

/**
 * What narrows the Project Documentation register (#275). `all` is no filter
 * for Project and Client; the register shows documentation-enabled Projects
 * unless DOCUMENTATION says otherwise.
 */
export type ProjectDocumentationFilters = {
  q: string;
  project: string;
  client: string;
  documentation: DocumentationSetting;
  page: number;
  pageSize: number;
};

export function readDocumentationFilters(search: string): ProjectDocumentationFilters {
  const params = new URLSearchParams(search);
  const pick = (name: string) => params.get(name)?.trim() || "all";
  const documentation = params.get("docs");
  return {
    q: params.get("q") ?? "",
    project: pick("project"),
    client: pick("client"),
    documentation: documentation === "disabled" || documentation === "all" ? documentation : "enabled",
    page: readPage(params),
    pageSize: readPageSize(params),
  };
}

/** The register's query string, leaving defaults out so a plain register stays bare. */
export function writeDocumentationFilters(search: string, filters: ProjectDocumentationFilters): string {
  const params = new URLSearchParams(search);
  if (filters.q.trim()) params.set("q", filters.q);
  else params.delete("q");
  for (const name of ["project", "client"] as const) {
    if (filters[name] !== "all") params.set(name, filters[name]);
    else params.delete(name);
  }
  if (filters.documentation !== "enabled") params.set("docs", filters.documentation);
  else params.delete("docs");
  writePaging(params, filters.page, filters.pageSize);
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function clearDocumentationFilters(filters: ProjectDocumentationFilters): ProjectDocumentationFilters {
  return { ...filters, q: "", project: "all", client: "all", documentation: "enabled", page: 1 };
}

/** The server page, scoped like the Projects register so a Member's page is never short. */
export function documentationRegisterPath(filters: ProjectDocumentationFilters): string {
  const params = new URLSearchParams({
    scope: "visible",
    page: String(filters.page),
    pageSize: String(filters.pageSize),
    documentation: filters.documentation,
  });
  if (filters.q.trim()) params.set("search", filters.q.trim());
  if (filters.project !== "all") params.set("projectId", filters.project);
  if (filters.client !== "all") params.set("clientId", filters.client);
  return `/api/projects/documentable?${params.toString()}`;
}

/** Names each filter in force, for the empty state. The default DOCUMENTATION ENABLED is not a filter. */
export function documentationFilterLabels(
  filters: ProjectDocumentationFilters,
  names: { projects: Map<string, string>; clients: Map<string, string> },
): string[] {
  const labels: string[] = [];
  if (filters.q.trim()) labels.push(`“${filters.q.trim()}”`);
  if (filters.project !== "all") labels.push(`PROJECT ${names.projects.get(filters.project) ?? "—"}`);
  if (filters.client !== "all") labels.push(`CLIENT ${names.clients.get(filters.client) ?? "—"}`);
  if (filters.documentation !== "enabled") {
    const label = DOCUMENTATION_OPTIONS.find((option) => option.value === filters.documentation)?.label;
    labels.push(`DOCUMENTATION ${label}`);
  }
  return labels;
}


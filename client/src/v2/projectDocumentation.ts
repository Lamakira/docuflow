import { chromeRefusal } from "./chrome";
import { projectFileHref } from "./fileViewer";
import { readPage, readPageSize, writePaging } from "./paging";
import { memberName } from "./today";
import {
  filteredFootLabel,
  libraryEmptyState,
  projectDocumentHref,
  unfilteredFootLabel,
  type LibraryModel,
  type LibraryPerson,
  type LibraryRow,
} from "./library";

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

export function projectFilesPath(projectId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/files`;
}

/** A File added to one Project (#278), listed with that Project's Documents. */
export type ProjectDocumentationFile = {
  id: string;
  name: string;
  projectId: string;
  updatedAt?: Date | string | null;
  createdAt?: Date | string | null;
  createdBy?: LibraryPerson | null;
};

export type ProjectDocumentationInput = {
  now: Date;
  workspaceName: string;
  projects: ProjectDocumentationProject[];
  documents: ProjectDocumentationDocument[];
  files?: ProjectDocumentationFile[];
  expandedProjectIds: string[];
  selectedProjectId: string | null;
  filterQuery: string;
  capabilityMiss?: boolean;
  ownerName?: string | null;
  /** Filters the server already applied, named for the empty state (#275). */
  activeFilters?: string[];
  /** The same filters in plain words, the search left out, for the designed empty state. */
  filterWords?: string[];
};

const PROJECT_PARENTS = { singular: "PROJECT", plural: "PROJECTS" } as const;

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
  const visibleFiles = (input.files ?? []).filter((file) => allowedProjectIds.has(file.projectId));
  const childrenByProject = new Map<string, ProjectDocumentationChild[]>();
  const children: ProjectDocumentationChild[] = [
    ...visibleDocs.map((document) => ({ kind: "document" as const, name: document.title, item: document })),
    ...visibleFiles.map((file) => ({ kind: "file" as const, name: file.name, item: file })),
  ];
  for (const child of children) {
    const list = childrenByProject.get(child.item.projectId) ?? [];
    list.push(child);
    childrenByProject.set(child.item.projectId, list);
  }

  const rows: LibraryRow[] = [];
  for (const project of visibleProjects) {
    const projectChildren = childrenByProject.get(project.documentProjectId) ?? [];
    const folderMatches = nameMatches(project.name, needle);
    const matchingChildren = needle
      ? projectChildren.filter((child) => nameMatches(child.name, needle))
      : projectChildren;
    if (needle && !folderMatches && matchingChildren.length === 0) continue;

    const showChildren = expanded.has(project.id) || (Boolean(needle) && matchingChildren.length > 0);
    rows.push(
      projectRow(project, projectChildren.map((child) => child.item), showChildren, project.id === input.selectedProjectId, input.now),
    );
    for (const child of matchingChildren) {
      rows.push(
        child.kind === "file"
          ? fileRow(child.item, project.name, input.now)
          : documentRow(child.item, project.name, input.now),
      );
    }
  }

  const empty = rows.length === 0;
  const activeFilters = input.activeFilters ?? [];
  const filterWords = input.filterWords ?? [];
  const itemCount = visibleDocs.length + visibleFiles.length + visibleProjects.length;
  const narrowing = Boolean(needle) || filterWords.length > 0;
  return {
    emptyState: empty
      ? libraryEmptyState({
          noun: "Project Documents",
          search: input.filterQuery.trim(),
          filterLabels: filterWords,
          noneCopy:
            "Project Documents belong to one Project and are visible to Members assigned to it. Add the first one, or a documentation-only Project to hold them.",
        })
      : null,
    footLabel: narrowing
      ? filteredFootLabel(rows, itemCount, PROJECT_PARENTS)
      : unfilteredFootLabel(itemCount, visibleProjects.length, PROJECT_PARENTS),
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
    itemCount,
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

type ProjectDocumentationChild =
  | { kind: "document"; name: string; item: ProjectDocumentationDocument }
  | { kind: "file"; name: string; item: ProjectDocumentationFile };

type Dated = {
  updatedAt?: Date | string | null;
  createdAt?: Date | string | null;
  createdBy?: LibraryPerson | null;
};

function projectRow(
  project: ProjectDocumentationProject,
  children: Dated[],
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

function fileRow(file: ProjectDocumentationFile, projectName: string, now: Date): LibraryRow {
  return {
    id: file.id,
    kind: "file",
    name: file.name,
    path: `${projectName} /`,
    type: "FILE",
    access: "ASSIGNED",
    editor: file.createdBy ? memberName(file.createdBy) : "—",
    updated: formatWhen(file.updatedAt ?? file.createdAt ?? null, now),
    child: true,
    depth: 1,
    href: projectFileHref({ projectId: file.projectId, id: file.id, name: file.name, back: "/project-documentation" }),
  };
}

function timestamp(document: Dated): number {
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
/** The PROJECT, CLIENT, and DOCUMENTATION filters in plain words. */
export function documentationFilterWords(
  filters: ProjectDocumentationFilters,
  names: { projects: Map<string, string>; clients: Map<string, string> },
): string[] {
  const words: string[] = [];
  if (filters.project !== "all") words.push(`Project: ${names.projects.get(filters.project) ?? "another Project"}`);
  if (filters.client !== "all") words.push(`Client: ${names.clients.get(filters.client) ?? "another Client"}`);
  if (filters.documentation !== "enabled") {
    words.push(`Documentation: ${filters.documentation === "disabled" ? "Disabled" : "Enabled or disabled"}`);
  }
  return words;
}

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


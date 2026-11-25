import { chromeRefusal } from "./chrome";
import { projectFileHref } from "./fileViewer";
import { readPage, readPageSize, writePaging } from "./paging";
import { memberName } from "./today";
import {
  filteredFootLabel,
  formatWhen,
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
  clientName?: string | null;
  isDocumentationOnly?: boolean;
  owner?: LibraryPerson | null;
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

/** What linking a documentation-only Project to a delivery one does, said before it is done. */
export function linkConsequence(input: { name: string; documents: number; files: number; target: string }): string {
  const count = input.documents + input.files;
  const left = `${input.name} is then left with documentation off. You can't undo this.`;
  if (count === 0) return `${input.name} has no Documents or Files to move. ${left}`;
  const moved =
    count === 1 ? `The ${input.documents === 1 ? "Document" : "File"}` : `The ${count} Documents and Files`;
  const readers = `Everyone who can see ${input.target} will see ${count === 1 ? "it" : "them"}.`;
  return `${moved} in ${input.name} ${count === 1 ? "moves" : "move"} to ${input.target}'s Documentation. ${readers} ${left}`;
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

const PROJECT_PARENTS = { singular: "project", plural: "projects" } as const;

export function composeProjectDocumentation(input: ProjectDocumentationInput): LibraryModel {
  const subhead = `Project Documents in ${input.workspaceName}, visible to Members assigned to that Project.`;
  if (input.capabilityMiss) {
    return {
      subhead,
      empty: true,
      refusal: chromeRefusal({
        kind: "capability",
        capability: "View Project Documents",
        ownerName: input.ownerName ?? null,
      }),
      rows: [],
      folderCount: 0,
      parentNoun: { singular: "project", plural: "projects" },
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
  const docsByProject = byProject(visibleDocs);
  const filesByProject = byProject(visibleFiles);

  const rows: LibraryRow[] = [];
  for (const project of visibleProjects) {
    const projectDocs = docsByProject.get(project.documentProjectId) ?? [];
    const projectFiles = filesByProject.get(project.documentProjectId) ?? [];
    const folderMatches = nameMatches(project.name, needle);
    const childMatches =
      projectDocs.some((document) => nameMatches(document.title, needle)) ||
      projectFiles.some((file) => nameMatches(file.name, needle));
    if (needle && !folderMatches && !childMatches) continue;

    // A Project found by its own name lists everything it holds (F62).
    const childNeedle = folderMatches ? "" : needle;
    const showChildren = expanded.has(project.id) || (Boolean(needle) && childMatches);
    rows.push(
      projectRow(project, [...projectDocs, ...projectFiles], showChildren, project.id === input.selectedProjectId, input.now),
    );
    for (const page of pageTree(projectDocs, childNeedle)) {
      rows.push(documentRow(page.document, [project.name, ...page.trail], input.now));
    }
    for (const file of projectFiles) {
      if (nameMatches(file.name, childNeedle)) rows.push(fileRow(file, project.name, input.now));
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
    filtered: empty && (activeFilters.length > 0 || Boolean(needle)),
    refusal: null,
    rows,
    folderCount: visibleProjects.length,
    parentNoun: { singular: "project", plural: "projects" },
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

function byProject<T extends { projectId: string }>(items: T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const list = grouped.get(item.projectId) ?? [];
    list.push(item);
    grouped.set(item.projectId, list);
  }
  return grouped;
}

type ProjectPage = { document: ProjectDocumentationDocument; trail: string[] };

/**
 * One Project's pages, each under its parent, siblings in the order received.
 * A page whose parent is missing sits at the Project's root, and so does the
 * first page of a cycle. A search keeps a match and the pages above it.
 */
function pageTree(documents: ProjectDocumentationDocument[], needle: string): ProjectPage[] {
  const known = new Set(documents.map((document) => document.id));
  const childrenOf = new Map<string, ProjectDocumentationDocument[]>();
  const roots: ProjectDocumentationDocument[] = [];
  for (const document of documents) {
    const parentId =
      document.parentId && document.parentId !== document.id && known.has(document.parentId) ? document.parentId : null;
    if (!parentId) {
      roots.push(document);
      continue;
    }
    const list = childrenOf.get(parentId) ?? [];
    list.push(document);
    childrenOf.set(parentId, list);
  }

  const seen = new Set<string>();
  function walk(document: ProjectDocumentationDocument, trail: string[]): ProjectPage[] {
    if (seen.has(document.id)) return [];
    seen.add(document.id);
    const inside = [...trail, document.title];
    const below = (childrenOf.get(document.id) ?? []).flatMap((child) => walk(child, inside));
    return below.length > 0 || nameMatches(document.title, needle) ? [{ document, trail }, ...below] : below;
  }
  // Whatever the roots did not reach belongs to a cycle.
  return [...roots, ...documents].flatMap((document) => walk(document, []));
}

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
  const itemLabel = count === 1 ? "1 item" : `${count} items`;
  return {
    id: project.id,
    // `kind` is the row's shape in the register — an expandable parent. `type`
    // is the word the reader gets, and this row is a Project (#245, F4).
    kind: "folder",
    name: project.name,
    path: project.documentationEnabled ? `/ · ${itemLabel}` : `/ · ${itemLabel} · Documentation off`,
    type: "Project",
    access: project.isDocumentationOnly ? "Documentation only" : project.clientName || "Internal",
    editor: project.owner ? memberName(project.owner) : "-",
    updated: formatWhen(latest?.updatedAt ?? latest?.createdAt ?? project.updatedAt ?? null, now),
    child: false,
    depth: 0,
    expanded,
    selected,
  };
}

function documentRow(document: ProjectDocumentationDocument, trail: string[], now: Date): LibraryRow {
  return {
    id: document.id,
    kind: "document",
    name: document.title,
    path: `${trail.join(" / ")} /`,
    type: "Document",
    access: "",
    editor: document.createdBy ? memberName(document.createdBy) : "-",
    updated: formatWhen(document.updatedAt ?? document.createdAt ?? null, now),
    child: true,
    depth: trail.length,
    href: projectDocumentHref(document.id),
  };
}

function fileRow(file: ProjectDocumentationFile, projectName: string, now: Date): LibraryRow {
  return {
    id: file.id,
    kind: "file",
    name: file.name,
    path: `${projectName} /`,
    type: "File",
    access: "",
    editor: file.createdBy ? memberName(file.createdBy) : "-",
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

/** The Project a new item starts in: the one selected, only where the list offers it (F64). */
export function offeredProject(
  options: Array<{ value: string }>,
  projectId: string | null,
): string | null {
  return options.find((option) => option.value === projectId)?.value ?? null;
}

export const DOCUMENTATION_OPTIONS = [
  { value: "enabled", label: "Enabled" },
  { value: "disabled", label: "Disabled" },
  { value: "all", label: "All" },
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
  if (filters.project !== "all") labels.push(`Project ${names.projects.get(filters.project) ?? "-"}`);
  if (filters.client !== "all") labels.push(`Client ${names.clients.get(filters.client) ?? "-"}`);
  if (filters.documentation !== "enabled") {
    const label = DOCUMENTATION_OPTIONS.find((option) => option.value === filters.documentation)?.label;
    labels.push(`Documentation ${label}`);
  }
  return labels;
}


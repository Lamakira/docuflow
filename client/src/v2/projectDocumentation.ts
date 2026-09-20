import { chromeRefusal } from "./chrome";
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
      itemCount: 0,
      preview: null,
    };
  }
  const needle = input.filterQuery.trim().toLowerCase();
  const expanded = new Set(input.expandedProjectIds);
  const visibleProjects = input.projects.filter((project) => project.visible && project.documentationEnabled);
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
  return {
    subhead,
    empty,
    emptyCopy: empty
      ? needle
        ? "No Project Documents match this filter."
        : "No Project Documents you can access."
      : "",
    refusal: null,
    rows,
    folderCount: visibleProjects.length,
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
    path: `/ · ${itemLabel}`,
    type: "PROJECT",
    access: "ASSIGNED",
    editor: latest?.createdBy ? memberName(latest.createdBy) : "—",
    updated: formatWhen(latest?.updatedAt ?? latest?.createdAt ?? project.updatedAt ?? null, now),
    child: false,
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


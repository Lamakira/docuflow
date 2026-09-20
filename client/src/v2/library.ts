import { memberName } from "./today";

export type LibraryPerson = {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
};

export type LibraryFolder = {
  id: string;
  name: string;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
  createdBy?: LibraryPerson | null;
};

export type LibraryDocument = {
  id: string;
  name: string;
  folderId?: string | null;
  access?: string | null;
  content?: unknown;
  storagePath?: string | null;
  fileName?: string | null;
  uploadedBy?: LibraryPerson | null;
  updatedAt?: Date | string | null;
  createdAt?: Date | string | null;
};

export type LibraryInput = {
  now: Date;
  workspaceName: string;
  folders: LibraryFolder[];
  documents: LibraryDocument[];
  expandedFolderIds: string[];
  selectedFolderId: string | null;
  filterQuery: string;
  capabilityMiss: boolean;
  ownerName: string | null;
};

export type LibraryRowKind = "folder" | "document" | "file";

export type LibraryRow = {
  id: string;
  kind: LibraryRowKind;
  name: string;
  path: string;
  /**
   * The word the reader sees in the TYPE column. `PROJECT` where a parent row
   * is a row in `projects` (#245, F4) — CONTEXT.md has no Folder term, and
   * calling one a folder sent both an operator and an investigation astray.
   */
  type: "FOLDER" | "PROJECT" | "DOCUMENT" | "FILE";
  access: string;
  editor: string;
  updated: string;
  child: boolean;
  expanded?: boolean;
  selected?: boolean;
  href?: string;
};

export type LibraryPreview = {
  title: string;
  meta: string;
  accessCopy: string;
};

export type LibraryModel = {
  subhead: string;
  empty: boolean;
  emptyCopy: string;
  refusal: string | null;
  rows: LibraryRow[];
  folderCount: number;
  /**
   * What this register's parents are called in its foot: folders in Workspace
   * Documents, Projects in Project Documentation, where every parent is a row
   * in `projects` (#245, F4).
   */
  parentNoun: { singular: string; plural: string };
  itemCount: number;
  preview: LibraryPreview | null;
};

export const FOLDER_PARENTS = { singular: "FOLDER", plural: "FOLDERS" } as const;

const VIEW_WORKSPACE_DOCUMENTS_CAPABILITY = "View Workspace Documents";
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

export function documentHref(id: string): string {
  return `/documents/${id}`;
}

export function projectDocumentHref(id: string): string {
  return `/document/${id}`;
}

export function composeLibrary(input: LibraryInput): LibraryModel {
  const subhead = librarySubhead(input.workspaceName);
  if (input.capabilityMiss) {
    const base = `You do not have the ${VIEW_WORKSPACE_DOCUMENTS_CAPABILITY} Capability.`;
    const refusal = input.ownerName ? `${base} ${input.ownerName} (Owner) can grant it.` : base;
    return {
      subhead,
      empty: true,
      emptyCopy: "",
      refusal,
      rows: [],
      folderCount: 0,
      parentNoun: FOLDER_PARENTS,
      itemCount: 0,
      preview: null,
    };
  }

  const visible = input.documents.filter(isVisibleDocument);
  const needle = input.filterQuery.trim().toLowerCase();
  const expanded = new Set(input.expandedFolderIds);
  const childrenByFolder = new Map<string, LibraryDocument[]>();
  const roots: LibraryDocument[] = [];
  for (const document of visible) {
    if (document.folderId) {
      const list = childrenByFolder.get(document.folderId) ?? [];
      list.push(document);
      childrenByFolder.set(document.folderId, list);
    } else {
      roots.push(document);
    }
  }

  const rows: LibraryRow[] = [];
  for (const folder of input.folders) {
    const children = childrenByFolder.get(folder.id) ?? [];
    const folderMatches = nameMatches(folder.name, needle);
    const matchingChildren = needle
      ? children.filter((document) => nameMatches(document.name, needle))
      : children;
    if (needle && !folderMatches && matchingChildren.length === 0) continue;

    const showChildren = expanded.has(folder.id) || (Boolean(needle) && matchingChildren.length > 0);
    const listedChildren = needle && !folderMatches ? matchingChildren : matchingChildren;
    rows.push(folderRow(folder, children, showChildren, folder.id === input.selectedFolderId, input.now));
    for (const document of listedChildren) {
      rows.push(itemRow(document, folder.name, true, input.now));
    }
  }

  for (const document of roots) {
    if (needle && !nameMatches(document.name, needle)) continue;
    rows.push(itemRow(document, "/", false, input.now));
  }

  const empty = rows.length === 0;
  const selected = input.folders.find((folder) => folder.id === input.selectedFolderId) ?? null;
  const preview = selected
    ? folderPreview(selected, childrenByFolder.get(selected.id) ?? [])
    : null;

  return {
    subhead,
    empty,
    emptyCopy: empty
      ? needle
        ? "No Workspace Documents match this filter."
        : "No Workspace Documents in this Workspace yet."
      : "",
    refusal: null,
    rows,
    folderCount: input.folders.length,
    parentNoun: FOLDER_PARENTS,
    itemCount: visible.length + input.folders.length,
    preview,
  };
}

function isVisibleDocument(document: LibraryDocument): boolean {
  const access = (document.access ?? "workspace").toLowerCase();
  return access === "workspace" || access === "everyone";
}

function nameMatches(name: string, needle: string): boolean {
  if (!needle) return true;
  return name.toLowerCase().includes(needle);
}

function folderRow(
  folder: LibraryFolder,
  children: LibraryDocument[],
  expanded: boolean,
  selected: boolean,
  now: Date,
): LibraryRow {
  const latestChild = [...children].sort((a, b) => timestamp(b) - timestamp(a))[0];
  const editorPerson = latestChild?.uploadedBy ?? folder.createdBy ?? null;
  const updatedAt = latestChild
    ? (latestChild.updatedAt ?? latestChild.createdAt ?? folder.updatedAt)
    : folder.updatedAt ?? folder.createdAt;
  const count = children.length;
  const itemLabel = count === 1 ? "1 ITEM" : `${count} ITEMS`;
  return {
    id: folder.id,
    kind: "folder",
    name: folder.name,
    path: `/ · ${itemLabel}`,
    type: "FOLDER",
    access: folderAccess(children),
    editor: editorPerson ? memberName(editorPerson) : "—",
    updated: formatWhen(updatedAt ?? null, now),
    child: false,
    expanded,
    selected,
  };
}

function itemRow(document: LibraryDocument, parentPath: string, child: boolean, now: Date): LibraryRow {
  const kind: LibraryRowKind = document.storagePath ? "file" : "document";
  return {
    id: document.id,
    kind,
    name: document.name,
    path: child ? `${parentPath} /` : parentPath,
    type: kind === "file" ? "FILE" : "DOCUMENT",
    access: accessLabel(document.access),
    editor: document.uploadedBy ? memberName(document.uploadedBy) : "—",
    updated: formatWhen(document.updatedAt ?? document.createdAt ?? null, now),
    child,
    href: documentHref(document.id),
  };
}

function folderPreview(folder: LibraryFolder, children: LibraryDocument[]): LibraryPreview {
  const count = children.length;
  const itemLabel = count === 1 ? "1 ITEM" : `${count} ITEMS`;
  return {
    title: folder.name,
    meta: `${itemLabel} · FOLDER`,
    accessCopy:
      "Everyone in this Workspace can view these Workspace Documents. Restricted items never appear in this register, search results, Ask DocuFlow answers, or notifications.",
  };
}

function folderAccess(children: LibraryDocument[]): string {
  const labels = new Set(children.map((document) => accessLabel(document.access)));
  if (labels.size > 1) return "MIXED";
  return labels.values().next().value ?? "EVERYONE";
}

function accessLabel(access: string | null | undefined): string {
  const value = (access ?? "workspace").toLowerCase();
  if (value === "workspace" || value === "everyone") return "EVERYONE";
  return value.replace(/_/g, " ").toUpperCase();
}

function timestamp(document: LibraryDocument): number {
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

function librarySubhead(workspaceName: string): string {
  const name = workspaceName.trim() || "this Workspace";
  return `Policies, profiles, benefits, and templates that belong to ${name} — not to a single Project.`;
}

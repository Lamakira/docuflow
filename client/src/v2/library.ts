import { memberName } from "./today";

export type LibraryPerson = {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
};

export type LibraryFolder = {
  id: string;
  name: string;
  /** The Folder this one sits in; null or unknown puts it at the Workspace root. */
  parentId?: string | null;
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
  /** How many Folders deep the row sits: 0 at the root. */
  depth: number;
  expanded?: boolean;
  selected?: boolean;
  href?: string;
};

export type LibraryPreview = {
  folderId: string;
  name: string;
  /** What the delete confirmation says: the route cascades to everything filed inside (#260). */
  deleteConsequence: string;
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

export type LibraryGroup =
  | { kind: "folder"; folder: LibraryRow; children: LibraryGroup[] }
  | { kind: "item"; row: LibraryRow };

/** Rows arrive parents first, each a level deeper than its Folder; this nests them back. */
export function groupLibraryRows(rows: LibraryRow[]): LibraryGroup[] {
  const groups: LibraryGroup[] = [];
  const open: Array<{ depth: number; group: Extract<LibraryGroup, { kind: "folder" }> }> = [];
  for (const row of rows) {
    while (open.length > 0 && open[open.length - 1].depth >= row.depth) open.pop();
    const siblings = open.length > 0 ? open[open.length - 1].group.children : groups;
    if (row.kind === "folder") {
      const group = { kind: "folder" as const, folder: row, children: [] as LibraryGroup[] };
      siblings.push(group);
      open.push({ depth: row.depth, group });
      continue;
    }
    siblings.push({ kind: "item", row });
  }
  return groups;
}

export const FOLDER_PARENTS = { singular: "FOLDER", plural: "FOLDERS" } as const;

const VIEW_WORKSPACE_DOCUMENTS_CAPABILITY = "View Workspace Documents";
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

export function documentHref(id: string): string {
  return `/documents/${id}`;
}

export function folderPath(id: string): string {
  return `/api/company-document-folders/${id}`;
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

  const tree = folderTree(input.folders);
  const rows: LibraryRow[] = [];

  /** Whether anything at or under this Folder answers the filter. */
  function subtreeMatches(folder: LibraryFolder): boolean {
    if (nameMatches(folder.name, needle)) return true;
    if ((childrenByFolder.get(folder.id) ?? []).some((document) => nameMatches(document.name, needle))) return true;
    return (tree.children.get(folder.id) ?? []).some(subtreeMatches);
  }

  function walk(folder: LibraryFolder, depth: number, trail: string[]) {
    if (needle && !subtreeMatches(folder)) return;
    const documents = childrenByFolder.get(folder.id) ?? [];
    const subfolders = tree.children.get(folder.id) ?? [];
    const listedDocuments = needle ? documents.filter((document) => nameMatches(document.name, needle)) : documents;
    const listedFolders = needle ? subfolders.filter(subtreeMatches) : subfolders;
    const showChildren =
      expanded.has(folder.id) || (Boolean(needle) && listedDocuments.length + listedFolders.length > 0);
    rows.push(
      folderRow(folder, documents, subfolders.length, trail, depth, showChildren, folder.id === input.selectedFolderId, input.now),
    );
    const inside = [...trail, folder.name];
    for (const subfolder of listedFolders) walk(subfolder, depth + 1, inside);
    for (const document of listedDocuments) {
      rows.push(itemRow(document, inside.join(" / "), depth + 1, input.now));
    }
  }

  for (const folder of tree.roots) walk(folder, 0, []);

  for (const document of roots) {
    if (needle && !nameMatches(document.name, needle)) continue;
    rows.push(itemRow(document, "/", 0, input.now));
  }

  const empty = rows.length === 0;
  const selected = input.folders.find((folder) => folder.id === input.selectedFolderId) ?? null;
  const preview = selected
    ? folderPreview(selected, childrenByFolder.get(selected.id) ?? [], tree.children.get(selected.id)?.length ?? 0)
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

type FolderTree = { roots: LibraryFolder[]; children: Map<string, LibraryFolder[]> };

/**
 * Folders by parent, in the order the route lists them. A Folder whose parent
 * is missing — deleted, or not visible — reads at the root rather than vanish.
 */
function folderTree(folders: LibraryFolder[]): FolderTree {
  const known = new Set(folders.map((folder) => folder.id));
  const roots: LibraryFolder[] = [];
  const children = new Map<string, LibraryFolder[]>();
  for (const folder of folders) {
    const parentId = folder.parentId && folder.parentId !== folder.id && known.has(folder.parentId) ? folder.parentId : null;
    if (!parentId) {
      roots.push(folder);
      continue;
    }
    const list = children.get(parentId) ?? [];
    list.push(folder);
    children.set(parentId, list);
  }
  return { roots, children };
}

export type FolderChoice = { value: string; label: string };

/** Every Folder a new item can go in, parents before children, named by its full path. */
export function folderChoices(folders: LibraryFolder[]): FolderChoice[] {
  const tree = folderTree(folders);
  const choices: FolderChoice[] = [];
  const seen = new Set<string>();
  function walk(folder: LibraryFolder, trail: string[]) {
    if (seen.has(folder.id)) return;
    seen.add(folder.id);
    const path = [...trail, folder.name];
    choices.push({ value: folder.id, label: path.join(" / ") });
    for (const child of tree.children.get(folder.id) ?? []) walk(child, path);
  }
  for (const folder of tree.roots) walk(folder, []);
  return choices;
}

function folderRow(
  folder: LibraryFolder,
  children: LibraryDocument[],
  subfolderCount: number,
  trail: string[],
  depth: number,
  expanded: boolean,
  selected: boolean,
  now: Date,
): LibraryRow {
  const latestChild = [...children].sort((a, b) => timestamp(b) - timestamp(a))[0];
  const editorPerson = latestChild?.uploadedBy ?? folder.createdBy ?? null;
  const updatedAt = latestChild
    ? (latestChild.updatedAt ?? latestChild.createdAt ?? folder.updatedAt)
    : folder.updatedAt ?? folder.createdAt;
  const count = children.length + subfolderCount;
  const itemLabel = count === 1 ? "1 ITEM" : `${count} ITEMS`;
  return {
    id: folder.id,
    kind: "folder",
    name: folder.name,
    path: trail.length > 0 ? `${trail.join(" / ")} / · ${itemLabel}` : `/ · ${itemLabel}`,
    type: "FOLDER",
    access: folderAccess(children),
    editor: editorPerson ? memberName(editorPerson) : "—",
    updated: formatWhen(updatedAt ?? null, now),
    child: depth > 0,
    depth,
    expanded,
    selected,
  };
}

function itemRow(document: LibraryDocument, parentPath: string, depth: number, now: Date): LibraryRow {
  const kind: LibraryRowKind = document.storagePath ? "file" : "document";
  const child = depth > 0;
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
    depth,
    href: documentHref(document.id),
  };
}

function folderPreview(folder: LibraryFolder, children: LibraryDocument[], subfolderCount: number): LibraryPreview {
  const count = children.length + subfolderCount;
  const itemLabel = count === 1 ? "1 ITEM" : `${count} ITEMS`;
  return {
    folderId: folder.id,
    name: folder.name,
    // The route cascades to every row filed under the folder, including
    // Restricted Documents and Files this register never lists, so the
    // confirmation cannot honestly give a count.
    deleteConsequence: `${folder.name} and everything filed in it, Folders inside it included, will be deleted, including items you may not be able to see. This cannot be undone.`,
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

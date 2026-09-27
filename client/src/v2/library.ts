import {
  ACCESS_ADMINISTRATORS,
  ACCESS_EVERYONE,
  ACCESS_RESTRICTED,
  accessLevelLabel,
  isReadableDocument,
  normalizeAccessLevel,
  type AccessLevel,
} from "@shared/documentAccess";
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
  access?: string | null;
  /** The level once the Folders above are counted, stamped by the route that checked it (#278). */
  effectiveAccess?: string | null;
  canManageAccess?: boolean;
};

export type LibraryDocument = {
  id: string;
  name: string;
  folderId?: string | null;
  access?: string | null;
  /** The level once its Folders are counted, stamped by the route that checked it (#278). */
  effectiveAccess?: string | null;
  canManageAccess?: boolean;
  content?: unknown;
  storagePath?: string | null;
  fileName?: string | null;
  uploadedById?: string | null;
  uploadedBy?: LibraryPerson | null;
  updatedAt?: Date | string | null;
  createdAt?: Date | string | null;
};

/**
 * What narrows the Workspace Documents register besides the name filter
 * (#278). `all` is no filter. OWNER is the Member who uploaded or created the
 * item; UPDATED is a window in days back from now.
 */
export type LibraryFilters = {
  q: string;
  type: "all" | "document" | "file";
  owner: string;
  access: "all" | AccessLevel;
  updated: "all" | "7" | "30" | "90";
};

export const LIBRARY_FILTERS_DEFAULT: LibraryFilters = {
  q: "",
  type: "all",
  owner: "all",
  access: "all",
  updated: "all",
};

export const LIBRARY_TYPE_OPTIONS = [
  { value: "all", label: "ALL" },
  { value: "document", label: "DOCUMENT" },
  { value: "file", label: "FILE" },
];

export const LIBRARY_ACCESS_OPTIONS = [
  { value: "all", label: "ANY" },
  { value: ACCESS_EVERYONE, label: "EVERYONE" },
  { value: ACCESS_RESTRICTED, label: "RESTRICTED" },
  { value: ACCESS_ADMINISTRATORS, label: "ADMINISTRATORS ONLY" },
];

export const LIBRARY_UPDATED_OPTIONS = [
  { value: "all", label: "ANY TIME" },
  { value: "7", label: "7 d" },
  { value: "30", label: "30 d" },
  { value: "90", label: "90 d" },
];

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
  /** TYPE, OWNER, ACCESS, and UPDATED; the name filter stays `filterQuery`. */
  filters?: Omit<LibraryFilters, "q">;
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
  /** Whether this reader may open Manage access on the Folder: its owner or an Administrator. */
  canManageAccess: boolean;
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
  /** Empty because of a filter, so the register offers to clear it (#275). */
  filtered?: boolean;
  /** The designed empty state (#277) when there are no rows. */
  emptyState?: LibraryEmptyState | null;
  /** The foot line; while filtered it says how many rows are shown of the whole. */
  footLabel?: string;
};

/**
 * Why a register is empty: nothing matches the name search, nothing matches
 * the filters, or there is nothing in it yet.
 */
export type LibraryEmptyState = {
  kind: "search" | "filters" | "none";
  title: string;
  copy: string;
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

  const visible = input.documents.filter(isReadableDocument);
  const needle = input.filterQuery.trim().toLowerCase();
  const facets = input.filters ?? LIBRARY_FILTERS_DEFAULT;
  const faceted = facetsActive(facets);
  const expanded = new Set(input.expandedFolderIds);
  const narrowing = Boolean(needle) || faceted;

  function itemMatches(document: LibraryDocument): boolean {
    return nameMatches(document.name, needle) && facetsMatch(document, facets, input.now);
  }
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

  /**
   * Whether anything at or under this Folder answers the filters. A Folder's
   * own name answers the name filter only; TYPE, OWNER, ACCESS, and UPDATED
   * ask about the items in it.
   */
  function subtreeMatches(folder: LibraryFolder): boolean {
    if (!faceted && nameMatches(folder.name, needle)) return true;
    if ((childrenByFolder.get(folder.id) ?? []).some(itemMatches)) return true;
    return (tree.children.get(folder.id) ?? []).some(subtreeMatches);
  }

  function walk(folder: LibraryFolder, depth: number, trail: string[]) {
    if (narrowing && !subtreeMatches(folder)) return;
    const documents = childrenByFolder.get(folder.id) ?? [];
    const subfolders = tree.children.get(folder.id) ?? [];
    const listedDocuments = narrowing ? documents.filter(itemMatches) : documents;
    const listedFolders = narrowing ? subfolders.filter(subtreeMatches) : subfolders;
    const showChildren =
      expanded.has(folder.id) || (narrowing && listedDocuments.length + listedFolders.length > 0);
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
    if (narrowing && !itemMatches(document)) continue;
    rows.push(itemRow(document, "/", 0, input.now));
  }

  const empty = rows.length === 0;
  const selected = input.folders.find((folder) => folder.id === input.selectedFolderId) ?? null;
  const preview = selected
    ? folderPreview(selected, childrenByFolder.get(selected.id) ?? [], tree.children.get(selected.id)?.length ?? 0)
    : null;
  const itemCount = visible.length + input.folders.length;
  const search = input.filterQuery.trim();
  const facetLabels = libraryFilterLabels(facets, libraryOwnerOptions(input.documents));

  return {
    emptyState: empty
      ? libraryEmptyState({
          noun: "Workspace Documents",
          search,
          filterLabels: facetLabels,
          noneCopy: `Workspace Documents are the policies, profiles, benefits, and templates that belong to ${input.workspaceName}. Add the first one, or a Folder to file them in.`,
        })
      : null,
    footLabel: narrowing
      ? filteredFootLabel(rows, itemCount, FOLDER_PARENTS)
      : unfilteredFootLabel(itemCount, input.folders.length, FOLDER_PARENTS),
    subhead,
    empty,
    emptyCopy: empty
      ? narrowing
        ? "No Workspace Documents match this filter."
        : "No Workspace Documents in this Workspace yet."
      : "",
    filtered: empty && narrowing,
    refusal: null,
    rows,
    folderCount: input.folders.length,
    parentNoun: FOLDER_PARENTS,
    itemCount,
    preview,
  };
}

/** The TYPE, OWNER, ACCESS, and UPDATED filters in plain words, as the empty state names them. */
export function libraryFilterLabels(
  facets: Omit<LibraryFilters, "q">,
  owners: Array<{ value: string; label: string }>,
): string[] {
  const labels: string[] = [];
  if (facets.type !== "all") labels.push(`Type: ${facets.type === "file" ? "File" : "Document"}`);
  if (facets.owner !== "all") {
    labels.push(`Owner: ${owners.find((owner) => owner.value === facets.owner)?.label ?? "a Member"}`);
  }
  if (facets.access !== "all") {
    const level =
      facets.access === ACCESS_EVERYONE ? "Everyone" : facets.access === ACCESS_RESTRICTED ? "Restricted" : "Administrators only";
    labels.push(`Access: ${level}`);
  }
  if (facets.updated !== "all") labels.push(`Updated: in the last ${facets.updated} days`);
  return labels;
}

/**
 * The search on its own names the text; any other filter names every filter,
 * the search among them.
 */
export function libraryEmptyState(input: {
  noun: string;
  search: string;
  filterLabels: string[];
  noneCopy: string;
}): LibraryEmptyState {
  const quoted = `“${input.search}”`;
  if (input.filterLabels.length > 0) {
    const labels = input.search ? [`Name: ${quoted}`, ...input.filterLabels] : input.filterLabels;
    return {
      kind: "filters",
      title: `No ${input.noun} match these filters`,
      copy: `Nothing here matches ${labels.join(" · ")}. Clear the filters to see everything you can open.`,
    };
  }
  if (input.search) {
    return {
      kind: "search",
      title: `No ${input.noun} match ${quoted}`,
      copy: `Nothing here has ${quoted} in its name. Try another word, or clear the search.`,
    };
  }
  return { kind: "none", title: `No ${input.noun} yet`, copy: input.noneCopy };
}

function parentLabel(count: number, noun: { singular: string; plural: string }): string {
  return `${count} ${count === 1 ? noun.singular : noun.plural}`;
}

export function unfilteredFootLabel(itemCount: number, parentCount: number, noun: { singular: string; plural: string }): string {
  return `${itemCount} ${itemCount === 1 ? "ITEM" : "ITEMS"} · ${parentLabel(parentCount, noun)}`;
}

/** “0 OF 4 ITEMS · 0 FOLDERS SHOWN”: the rows a filter left, out of everything. */
export function filteredFootLabel(
  rows: LibraryRow[],
  itemCount: number,
  noun: { singular: string; plural: string },
): string {
  const parents = rows.filter((row) => row.kind === "folder").length;
  return `${rows.length} OF ${itemCount} ${itemCount === 1 ? "ITEM" : "ITEMS"} · ${parentLabel(parents, noun)} SHOWN`;
}

function facetsActive(facets: Omit<LibraryFilters, "q">): boolean {
  return facets.type !== "all" || facets.owner !== "all" || facets.access !== "all" || facets.updated !== "all";
}

function facetsMatch(document: LibraryDocument, facets: Omit<LibraryFilters, "q">, now: Date): boolean {
  if (facets.type !== "all" && (document.storagePath ? "file" : "document") !== facets.type) return false;
  if (facets.owner !== "all" && document.uploadedById !== facets.owner) return false;
  if (facets.access !== "all" && itemAccess(document) !== facets.access) return false;
  if (facets.updated !== "all") {
    const when = parseDate(document.updatedAt ?? document.createdAt ?? null);
    const since = now.getTime() - Number(facets.updated) * 24 * 60 * 60 * 1000;
    if (!when || when.getTime() < since) return false;
  }
  return true;
}

/** The level a row shows and ACCESS filters by: the checked level where the route stamped one. */
function itemAccess(item: { access?: string | null; effectiveAccess?: string | null }): AccessLevel {
  return normalizeAccessLevel(item.effectiveAccess ?? item.access) ?? ACCESS_ADMINISTRATORS;
}

/** Every Member who owns a listed item, for the OWNER chip. */
export function libraryOwnerOptions(documents: LibraryDocument[]): Array<{ value: string; label: string }> {
  const owners = new Map<string, string>();
  for (const document of documents) {
    if (!document.uploadedById || owners.has(document.uploadedById) || !isReadableDocument(document)) continue;
    owners.set(document.uploadedById, document.uploadedBy ? memberName(document.uploadedBy) : "Member");
  }
  return [...owners]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

const TYPE_VALUES = new Set(["document", "file"]);
const UPDATED_VALUES = new Set(["7", "30", "90"]);

export function readLibraryFilters(search: string): LibraryFilters {
  const params = new URLSearchParams(search);
  const type = params.get("type") ?? "";
  const updated = params.get("updated") ?? "";
  const access = params.get("access") ? normalizeAccessLevel(params.get("access")) : null;
  return {
    q: params.get("q") ?? "",
    type: TYPE_VALUES.has(type) ? (type as LibraryFilters["type"]) : "all",
    owner: params.get("owner")?.trim() || "all",
    access: access ?? "all",
    updated: UPDATED_VALUES.has(updated) ? (updated as LibraryFilters["updated"]) : "all",
  };
}

/** The register's query string, leaving defaults out so a plain register stays bare. */
export function writeLibraryFilters(search: string, filters: LibraryFilters): string {
  const params = new URLSearchParams(search);
  if (filters.q.trim()) params.set("q", filters.q);
  else params.delete("q");
  for (const name of ["type", "owner", "access", "updated"] as const) {
    if (filters[name] !== "all") params.set(name, filters[name]);
    else params.delete(name);
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function clearLibraryFilters(): LibraryFilters {
  return { ...LIBRARY_FILTERS_DEFAULT };
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
    access: accessLevelLabel(itemAccess(folder)),
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
    access: accessLevelLabel(itemAccess(document)),
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
    accessCopy: FOLDER_ACCESS_COPY[itemAccess(folder)],
    canManageAccess: folder.canManageAccess === true,
  };
}

const HIDDEN_ELSEWHERE =
  "A Member without access never meets a closed item in this register, search results, previews, direct links, or Ask DocuFlow answers.";

const FOLDER_ACCESS_COPY: Record<AccessLevel, string> = {
  [ACCESS_EVERYONE]: `Everyone in this Workspace can view this Folder. An item inside can be restricted further. ${HIDDEN_ELSEWHERE}`,
  [ACCESS_RESTRICTED]: `Restricted to the Members named on this Folder, its owner, and Administrators. ${HIDDEN_ELSEWHERE}`,
  [ACCESS_ADMINISTRATORS]: `Administrators only. ${HIDDEN_ELSEWHERE}`,
};

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

/**
 * Document Access as CONTEXT.md uses it (#278): Everyone, Restricted to named
 * Members, or Administrators only, on a Workspace Document, File, or Folder.
 *
 * An item's own level narrows its Folder's; it never widens it. Visibility is
 * every level on the way up allowing the reader, so a Folder closed after its
 * items were filed closes them too. The Owner and Administrators see and may
 * change every item; an item's owner keeps sight of it at its own level and
 * may change it.
 */

export const ACCESS_EVERYONE = "workspace";
export const ACCESS_RESTRICTED = "restricted";
export const ACCESS_ADMINISTRATORS = "administrators";

export type AccessLevel = typeof ACCESS_EVERYONE | typeof ACCESS_RESTRICTED | typeof ACCESS_ADMINISTRATORS;

export const ACCESS_LEVELS: readonly AccessLevel[] = [ACCESS_EVERYONE, ACCESS_RESTRICTED, ACCESS_ADMINISTRATORS];

/** The reader: who they are, and whether their Workspace Role is Owner or Administrator. */
export type AccessViewer = { userId: string; administrator: boolean };

/** One level on the way up: an item or a Folder. */
export type AccessNode = {
  id: string;
  name: string;
  access: string | null | undefined;
  ownerId: string | null | undefined;
  memberIds: readonly string[];
};

export type AccessFolder = AccessNode & { parentId?: string | null };

/** `everyone` is the synonym older rows and callers use for the Workspace level. */
export function normalizeAccessLevel(access: string | null | undefined): AccessLevel | null {
  const value = (access ?? ACCESS_EVERYONE).toLowerCase();
  if (value === ACCESS_EVERYONE || value === "everyone") return ACCESS_EVERYONE;
  if (value === ACCESS_RESTRICTED) return ACCESS_RESTRICTED;
  if (value === ACCESS_ADMINISTRATORS) return ACCESS_ADMINISTRATORS;
  return null;
}

function rank(level: AccessLevel): number {
  return ACCESS_LEVELS.indexOf(level);
}

/** Whether the level alone lets every Member in, before any Folder is counted. */
export function isVisibleDocumentAccess(access: string | null | undefined): boolean {
  return normalizeAccessLevel(access) === ACCESS_EVERYONE;
}

/**
 * Whether a row a response carried may be shown. The routes that filter by the
 * reader's access stamp `effectiveAccess` on what they return; any other row is
 * shown only at Everyone, so a path that never checked access fails closed.
 */
export function isReadableDocument(row: {
  access?: string | null;
  effectiveAccess?: string | null;
}): boolean {
  return row.effectiveAccess != null || isVisibleDocumentAccess(row.access);
}

export function nodeAllows(node: AccessNode, viewer: AccessViewer): boolean {
  if (viewer.administrator) return true;
  const level = normalizeAccessLevel(node.access);
  if (level === ACCESS_EVERYONE) return true;
  // An unknown level fails closed for everyone but the Administrators.
  if (level === null) return false;
  if (node.ownerId && node.ownerId === viewer.userId) return true;
  if (level === ACCESS_RESTRICTED) return node.memberIds.includes(viewer.userId);
  return false;
}

/** The Folders enclosing `folderId`, nearest first. A cycle or a missing parent ends the walk. */
export function folderChain(folders: ReadonlyMap<string, AccessFolder>, folderId: string | null | undefined): AccessFolder[] {
  const chain: AccessFolder[] = [];
  const seen = new Set<string>();
  let cursor = folderId ?? null;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const folder = folders.get(cursor);
    if (!folder) break;
    chain.push(folder);
    cursor = folder.parentId ?? null;
  }
  return chain;
}

/** A Folder is visible when it and every Folder above it allow the reader. */
export function folderVisible(
  folders: ReadonlyMap<string, AccessFolder>,
  folderId: string,
  viewer: AccessViewer,
): boolean {
  if (!folders.has(folderId)) return false;
  return folderChain(folders, folderId).every((folder) => nodeAllows(folder, viewer));
}

/** An item is visible when it, its Folder, and every Folder above allow the reader. */
export function itemVisible(
  folders: ReadonlyMap<string, AccessFolder>,
  item: AccessNode & { folderId?: string | null },
  viewer: AccessViewer,
): boolean {
  if (!nodeAllows(item, viewer)) return false;
  if (!item.folderId) return true;
  if (!folders.has(item.folderId)) return false;
  return folderChain(folders, item.folderId).every((folder) => nodeAllows(folder, viewer));
}

/** What the Folders above an item already demand of it. */
export type InheritedAccess = {
  level: AccessLevel;
  /** The nearest Folder setting that level; null when nothing above restricts. */
  from: { id: string; name: string } | null;
  /**
   * Who a Restricted item may name: the Members every Restricted Folder above
   * names, each Folder's owner included. Null when no Folder above restricts.
   */
  memberIds: string[] | null;
};

export function inheritedAccess(chain: readonly AccessFolder[]): InheritedAccess {
  let level: AccessLevel = ACCESS_EVERYONE;
  let from: { id: string; name: string } | null = null;
  const namedSets: Array<Set<string>> = [];
  for (const folder of chain) {
    const folderLevel = normalizeAccessLevel(folder.access) ?? ACCESS_ADMINISTRATORS;
    if (folderLevel === ACCESS_RESTRICTED) {
      namedSets.push(new Set([...folder.memberIds, ...(folder.ownerId ? [folder.ownerId] : [])]));
    }
    if (rank(folderLevel) > rank(level)) {
      level = folderLevel;
      from = { id: folder.id, name: folder.name };
    }
  }
  const [first, ...rest] = namedSets;
  const memberIds = first ? [...first].filter((id) => rest.every((named) => named.has(id))).sort() : null;
  return { level, from, memberIds };
}

/** The level that applies to an item once its Folders are counted: the tighter of the two. */
export function effectiveAccessLevel(own: string | null | undefined, inherited: InheritedAccess): AccessLevel {
  const level = normalizeAccessLevel(own) ?? ACCESS_ADMINISTRATORS;
  return rank(level) >= rank(inherited.level) ? level : inherited.level;
}

/** Levels an item may take inside its Folders. Everyone there reads as "same as its Folder". */
export function allowedAccessLevels(inherited: InheritedAccess): AccessLevel[] {
  return ACCESS_LEVELS.filter((level) => level === ACCESS_EVERYONE || rank(level) >= rank(inherited.level));
}

/** The item's owner and the Administrators change its access. Members do not. */
export function canChangeAccess(viewer: AccessViewer, ownerId: string | null | undefined): boolean {
  return viewer.administrator || (Boolean(ownerId) && ownerId === viewer.userId);
}

export type AccessChange = { level: AccessLevel; memberIds: string[] };

/**
 * Why a requested change would open an item wider than its Folders, or null
 * when it may be saved. Everyone inside a closed Folder is not wider: it
 * leaves the Folder's access in charge.
 */
export function accessChangeRefusal(change: AccessChange, inherited: InheritedAccess): string | null {
  if (change.level === ACCESS_EVERYONE) return null;
  if (rank(change.level) < rank(inherited.level)) {
    const folder = inherited.from?.name ?? "its Folder";
    return `This item cannot be more open than ${folder}, which is Administrators only.`;
  }
  if (change.level === ACCESS_RESTRICTED) {
    if (change.memberIds.length === 0) return "Name at least one Member for Restricted access.";
    if (inherited.memberIds) {
      const allowed = new Set(inherited.memberIds);
      if (change.memberIds.some((id) => !allowed.has(id))) {
        const folder = inherited.from?.name ?? "its Folder";
        return `Only Members who can see ${folder} can be named here.`;
      }
    }
  }
  return null;
}

/** The word the register's ACCESS column shows for a level. */
export function accessLevelLabel(access: string | null | undefined): string {
  const level = normalizeAccessLevel(access);
  if (level === ACCESS_EVERYONE) return "EVERYONE";
  if (level === ACCESS_RESTRICTED) return "RESTRICTED";
  return "ADMINISTRATORS ONLY";
}

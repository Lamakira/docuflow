/**
 * Document Access on Workspace Documents, Files, and Folders (#278).
 *
 * The rules are `@shared/documentAccess`; this is where they meet the rows.
 * Every route that lists, searches, reads, or answers from Workspace Documents
 * loads one graph per request and asks it, so a Member without access meets
 * the same answer everywhere: the item is not there.
 */

import { and, eq } from "drizzle-orm";
import {
  auditEvents,
  companyDocumentFolders,
  companyDocuments,
  documentAccessMembers,
  files,
} from "@shared/schema";
import {
  ACCESS_RESTRICTED,
  accessChangeRefusal,
  allowedAccessLevels,
  canChangeAccess,
  effectiveAccessLevel,
  folderChain,
  folderVisible,
  inheritedAccess,
  itemVisible,
  normalizeAccessLevel,
  type AccessChange,
  type AccessFolder,
  type AccessLevel,
  type AccessNode,
  type AccessViewer,
  type InheritedAccess,
} from "@shared/documentAccess";
import { db } from "../../db";
import { activeMemberUserIds, inWorkspace, stampWorkspace } from "../../workspaceContext";
import { canManageAdministration } from "../../workspaceRole";

export async function accessViewer(userId: string): Promise<AccessViewer> {
  return { userId, administrator: await canManageAdministration() };
}

export type AccessGraph = {
  folders: Map<string, AccessFolder>;
  documentMembers: Map<string, string[]>;
};

/** Every Folder and every named Member in the Active Workspace, once per request. */
export async function loadAccessGraph(): Promise<AccessGraph> {
  const [folderRows, memberRows] = await Promise.all([
    db
      .select({
        id: companyDocumentFolders.id,
        name: companyDocumentFolders.name,
        parentId: companyDocumentFolders.parentId,
        access: companyDocumentFolders.access,
        createdById: companyDocumentFolders.createdById,
      })
      .from(companyDocumentFolders)
      .where(inWorkspace(companyDocumentFolders)),
    db
      .select({
        folderId: documentAccessMembers.folderId,
        documentId: documentAccessMembers.documentId,
        userId: documentAccessMembers.userId,
      })
      .from(documentAccessMembers)
      .where(inWorkspace(documentAccessMembers)),
  ]);

  const folderMembers = new Map<string, string[]>();
  const documentMembers = new Map<string, string[]>();
  for (const row of memberRows) {
    const [map, key] = row.folderId ? [folderMembers, row.folderId] : [documentMembers, row.documentId];
    if (!key) continue;
    const list = map.get(key) ?? [];
    list.push(row.userId);
    map.set(key, list);
  }

  const folders = new Map<string, AccessFolder>();
  for (const row of folderRows) {
    folders.set(row.id, {
      id: row.id,
      name: row.name,
      parentId: row.parentId,
      access: row.access,
      ownerId: row.createdById,
      memberIds: folderMembers.get(row.id) ?? [],
    });
  }
  return { folders, documentMembers };
}

type DocumentLike = {
  id: string;
  name: string;
  access: string | null;
  uploadedById: string | null;
  folderId: string | null;
};

type FolderLike = { id: string; parentId?: string | null };

function documentNode(graph: AccessGraph, document: DocumentLike): AccessNode & { folderId: string | null } {
  return {
    id: document.id,
    name: document.name,
    access: document.access,
    ownerId: document.uploadedById,
    memberIds: graph.documentMembers.get(document.id) ?? [],
    folderId: document.folderId,
  };
}

export function canSeeDocument(graph: AccessGraph, viewer: AccessViewer, document: DocumentLike): boolean {
  return itemVisible(graph.folders, documentNode(graph, document), viewer);
}

export function canSeeFolder(graph: AccessGraph, viewer: AccessViewer, folderId: string): boolean {
  return folderVisible(graph.folders, folderId, viewer);
}

function documentInherited(graph: AccessGraph, document: DocumentLike): InheritedAccess {
  return inheritedAccess(folderChain(graph.folders, document.folderId));
}

function folderInherited(graph: AccessGraph, folder: FolderLike): InheritedAccess {
  const parentId = graph.folders.get(folder.id)?.parentId ?? folder.parentId ?? null;
  return inheritedAccess(folderChain(graph.folders, parentId));
}

/** A listed row, with the level that applies to it and whether the reader may change it. */
export function annotateDocument<T extends DocumentLike>(graph: AccessGraph, viewer: AccessViewer, document: T) {
  return {
    ...document,
    effectiveAccess: effectiveAccessLevel(document.access, documentInherited(graph, document)),
    canManageAccess: canChangeAccess(viewer, document.uploadedById),
  };
}

export function annotateFolder<T extends FolderLike & { access: string; createdById: string }>(
  graph: AccessGraph,
  viewer: AccessViewer,
  folder: T,
) {
  return {
    ...folder,
    effectiveAccess: effectiveAccessLevel(folder.access, folderInherited(graph, folder)),
    canManageAccess: canChangeAccess(viewer, folder.createdById),
  };
}

/** What the Manage access dialog reads and writes. */
export type AccessState = {
  kind: "document" | "folder";
  id: string;
  name: string;
  level: AccessLevel;
  memberIds: string[];
  effectiveLevel: AccessLevel;
  inherited: InheritedAccess;
  allowedLevels: AccessLevel[];
  ownerId: string | null;
  canChange: boolean;
};

export function documentAccessState(graph: AccessGraph, viewer: AccessViewer, document: DocumentLike): AccessState {
  const inherited = documentInherited(graph, document);
  return {
    kind: "document",
    id: document.id,
    name: document.name,
    level: normalizeAccessLevel(document.access) ?? "administrators",
    memberIds: [...(graph.documentMembers.get(document.id) ?? [])].sort(),
    effectiveLevel: effectiveAccessLevel(document.access, inherited),
    inherited,
    allowedLevels: allowedAccessLevels(inherited),
    ownerId: document.uploadedById,
    canChange: canChangeAccess(viewer, document.uploadedById),
  };
}

export function folderAccessState(graph: AccessGraph, viewer: AccessViewer, folderId: string): AccessState | null {
  const folder = graph.folders.get(folderId);
  if (!folder) return null;
  const inherited = folderInherited(graph, folder);
  return {
    kind: "folder",
    id: folder.id,
    name: folder.name,
    level: normalizeAccessLevel(folder.access) ?? "administrators",
    memberIds: [...folder.memberIds].sort(),
    effectiveLevel: effectiveAccessLevel(folder.access, inherited),
    inherited,
    allowedLevels: allowedAccessLevels(inherited),
    ownerId: folder.ownerId ?? null,
    canChange: canChangeAccess(viewer, folder.ownerId),
  };
}

export class AccessChangeError extends Error {
  constructor(
    readonly statusCode: 400 | 403,
    message: string,
  ) {
    super(message);
    this.name = "AccessChangeError";
  }
}

/**
 * Save a change the reader asked for. The route has already proven the item
 * is visible; this refuses a reader who may not change it, a level wider than
 * the Folders above, and a name that is not an active Member of the Workspace.
 */
export async function changeAccess(
  state: AccessState,
  viewer: AccessViewer,
  change: AccessChange,
): Promise<void> {
  if (!state.canChange) {
    throw new AccessChangeError(403, "Only the owner of this item or an Administrator can change its access");
  }
  const refusal = accessChangeRefusal(change, state.inherited);
  if (refusal) throw new AccessChangeError(400, refusal);

  const memberIds = change.level === ACCESS_RESTRICTED ? [...new Set(change.memberIds)] : [];
  if (memberIds.length > 0) {
    const active = await activeMemberUserIds();
    if (memberIds.some((id) => !active.has(id))) {
      throw new AccessChangeError(400, "Only active Members of this Workspace can be named");
    }
  }

  await db.transaction(async (tx) => {
    const ownColumn = state.kind === "folder" ? documentAccessMembers.folderId : documentAccessMembers.documentId;
    await tx.delete(documentAccessMembers).where(and(eq(ownColumn, state.id), inWorkspace(documentAccessMembers)));
    if (memberIds.length > 0) {
      await tx.insert(documentAccessMembers).values(
        memberIds.map((userId) =>
          stampWorkspace({
            userId,
            folderId: state.kind === "folder" ? state.id : null,
            documentId: state.kind === "document" ? state.id : null,
          }),
        ),
      );
    }
    if (state.kind === "folder") {
      await tx
        .update(companyDocumentFolders)
        .set({ access: change.level, updatedAt: new Date() })
        .where(and(eq(companyDocumentFolders.id, state.id), inWorkspace(companyDocumentFolders)));
    } else {
      await tx
        .update(companyDocuments)
        .set({ access: change.level, updatedAt: new Date() })
        .where(and(eq(companyDocuments.id, state.id), inWorkspace(companyDocuments)));
      await tx
        .update(files)
        .set({ access: change.level, updatedAt: new Date() })
        .where(and(eq(files.id, state.id), inWorkspace(files)));
    }
    await tx.insert(auditEvents).values(
      stampWorkspace({
        actorKind: "user" as const,
        actorId: viewer.userId,
        action: "document_access.changed",
        resourceType: state.kind === "folder" ? "company_document_folders" : "company_documents",
        resourceId: state.id,
        payload: { from: state.level, to: change.level, memberCount: memberIds.length },
      }),
    );
  });
}

/** Every Workspace Document this reader may see, with the level that applies to it, for the answer paths. */
export async function visibleWorkspaceDocuments(
  viewer: AccessViewer,
  graph?: AccessGraph,
): Promise<Map<string, AccessLevel>> {
  const loaded = graph ?? (await loadAccessGraph());
  const rows = await db
    .select({
      id: companyDocuments.id,
      name: companyDocuments.name,
      access: companyDocuments.access,
      uploadedById: companyDocuments.uploadedById,
      folderId: companyDocuments.folderId,
    })
    .from(companyDocuments)
    .where(inWorkspace(companyDocuments));
  return new Map(
    rows
      .filter((row) => canSeeDocument(loaded, viewer, row))
      .map((row) => [row.id, annotateDocument(loaded, viewer, row).effectiveAccess] as const),
  );
}

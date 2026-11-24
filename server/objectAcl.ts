/**
 * Access policy for a stored object, and the decision made from it.
 *
 * This module used to fetch the policy itself, out of Google Cloud Storage
 * custom metadata, which made it a second place the storage provider leaked
 * into. Where a policy is kept is now the storage port's business — GCS keeps it
 * in object metadata, Replit App Storage has no metadata API and keeps it
 * beside the object — and what remains here is the part that is the same
 * wherever it came from: what a policy means.
 */

export enum ObjectAccessGroupType {
  /** Whoever reads the Workspace Document the object was placed in (F56). */
  WORKSPACE_DOCUMENT = "workspace_document",
}

export interface ObjectAccessGroup {
  type: ObjectAccessGroupType;
  id: string;
}

export enum ObjectPermission {
  READ = "read",
  WRITE = "write",
}

export interface ObjectAclRule {
  group: ObjectAccessGroup;
  permission: ObjectPermission;
}

export interface ObjectAclPolicy {
  owner: string;
  visibility: "public" | "private";
  aclRules?: Array<ObjectAclRule>;
}

function isPermissionAllowed(
  requested: ObjectPermission,
  granted: ObjectPermission
): boolean {
  if (requested === ObjectPermission.READ) {
    return [ObjectPermission.READ, ObjectPermission.WRITE].includes(granted);
  }
  return granted === ObjectPermission.WRITE;
}

abstract class BaseObjectAccessGroup implements ObjectAccessGroup {
  constructor(
    public readonly type: ObjectAccessGroupType,
    public readonly id: string
  ) {}

  public abstract hasMember(userId: string): Promise<boolean>;
}

type WorkspaceDocumentReader = (userId: string, documentId: string) => Promise<boolean>;

/** Registered by the Knowledge module, which this one must not import. Denies until it is. */
let readsWorkspaceDocument: WorkspaceDocumentReader = async () => false;

export function setWorkspaceDocumentReader(read: WorkspaceDocumentReader): void {
  readsWorkspaceDocument = read;
}

class WorkspaceDocumentAccessGroup extends BaseObjectAccessGroup {
  async hasMember(userId: string): Promise<boolean> {
    return readsWorkspaceDocument(userId, this.id);
  }
}

/** The Workspace Document an object was placed in, or null when it is tied to none. */
export function workspaceDocumentOf(aclPolicy: ObjectAclPolicy | null): string | null {
  const rule = aclPolicy?.aclRules?.find(({ group }) => group.type === ObjectAccessGroupType.WORKSPACE_DOCUMENT);
  return rule ? rule.group.id : null;
}

function createObjectAccessGroup(
  group: ObjectAccessGroup
): BaseObjectAccessGroup {
  switch (group.type) {
    case ObjectAccessGroupType.WORKSPACE_DOCUMENT:
      return new WorkspaceDocumentAccessGroup(group.type, group.id);
    default:
      throw new Error(`Unknown access group type: ${group.type}`);
  }
}

export async function canAccessObject({
  userId,
  aclPolicy,
  requestedPermission,
}: {
  userId?: string;
  /** Read through the storage port. A null policy denies, as it always has. */
  aclPolicy: ObjectAclPolicy | null;
  requestedPermission: ObjectPermission;
}): Promise<boolean> {
  if (!aclPolicy) {
    return false;
  }

  if (
    aclPolicy.visibility === "public" &&
    requestedPermission === ObjectPermission.READ
  ) {
    return true;
  }

  if (!userId) {
    return false;
  }

  // An object placed in a Document is read by the Document's readers; having
  // uploaded it gives no more.
  if (aclPolicy.owner === userId && workspaceDocumentOf(aclPolicy) === null) {
    return true;
  }

  for (const rule of aclPolicy.aclRules || []) {
    const accessGroup = createObjectAccessGroup(rule.group);
    if (
      (await accessGroup.hasMember(userId)) &&
      isPermissionAllowed(requestedPermission, rule.permission)
    ) {
      return true;
    }
  }

  return false;
}

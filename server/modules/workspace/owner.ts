import { and, eq, isNull } from "drizzle-orm";
import { memberships, workspaceRoles } from "@shared/schema";
import { db } from "../../db";
import { inWorkspace } from "../../workspaceContext";

/**
 * The Owner Membership's user id in the Active Workspace. Create Client on
 * `/api/v1` stamps this as `ownerId` because a Service Account is not a User.
 */
export async function workspaceOwnerUserId(): Promise<string> {
  const rows = await db
    .select({ userId: memberships.userId, slug: workspaceRoles.slug })
    .from(memberships)
    .innerJoin(workspaceRoles, eq(memberships.workspaceRoleId, workspaceRoles.id))
    .where(and(inWorkspace(memberships), isNull(memberships.archivedAt)));
  const owner = rows.find((row) => row.slug === "owner") ?? rows[0];
  if (!owner) {
    throw new Error("Workspace has no Member to own a Client");
  }
  return owner.userId;
}

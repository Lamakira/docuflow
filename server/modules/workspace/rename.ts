import { eq } from "drizzle-orm";
import { auditEvents, workspaces } from "@shared/schema";
import { db } from "../../db";
import { requireWorkspaceContext, stampWorkspace } from "../../workspaceContext";
import { currentWorkspaceRoleSlug } from "../../workspaceRole";

export class WorkspaceRenameRefusedError extends Error {
  readonly statusCode = 403;
  constructor() {
    super("Only the Owner can rename the Workspace");
    this.name = "WorkspaceRenameRefusedError";
  }
}

/**
 * Renames the Workspace this request entered (F110). `workspaces` has no row
 * security, so the Workspace is the context's, never one named by the caller.
 */
export async function renameWorkspace(actorUserId: string, name: string): Promise<{ id: string; name: string }> {
  if ((await currentWorkspaceRoleSlug()) !== "owner") throw new WorkspaceRenameRefusedError();
  const { workspaceId } = requireWorkspaceContext();
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select({ name: workspaces.name })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .for("update");
    const [row] = await tx
      .update(workspaces)
      .set({ name, updatedAt: new Date() })
      .where(eq(workspaces.id, workspaceId))
      .returning({ id: workspaces.id, name: workspaces.name });
    await tx.insert(auditEvents).values(
      stampWorkspace({
        actorKind: "user" as const,
        actorId: actorUserId,
        action: "workspace.renamed",
        resourceType: "workspaces",
        resourceId: workspaceId,
        payload: { name, previousName: before?.name ?? null },
      }),
    );
    return row;
  });
}

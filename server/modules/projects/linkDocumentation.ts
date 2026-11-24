/**
 * Linking a documentation-only Project to the Project its Documents belong to:
 * every Document and Project File moves there, with everything indexed from them.
 */

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { auditEvents, crmProjects, documents, files, projects } from "@shared/schema";
import { isDeliveryProject } from "@shared/projectLifecycle";
import { db } from "../../db";
import { syncDocumentProjectRows } from "../../embeddings";
import { inWorkspace, requireWorkspaceContext, stampWorkspace } from "../../workspaceContext";

export class LinkDocumentationError extends Error {
  constructor(
    readonly statusCode: 400 | 404,
    message: string,
  ) {
    super(message);
    this.name = "LinkDocumentationError";
  }
}

/** Both ids are `crm_projects` ids. The caller has proven the actor may administer the Workspace. */
export async function linkDocumentation(
  sourceId: string,
  targetId: string,
  actorId: string,
): Promise<{ targetId: string; documents: number; files: number }> {
  const { workspaceId } = requireWorkspaceContext();
  return db.transaction(async (tx) => {
    const locked = await tx
      .select()
      .from(crmProjects)
      .where(and(inArray(crmProjects.id, [sourceId, targetId]), inWorkspace(crmProjects)))
      .orderBy(asc(crmProjects.id))
      .for("update");
    const source = locked.find((row) => row.id === sourceId);
    if (!source) throw new LinkDocumentationError(404, "Project not found");
    if (!source.isDocumentationOnly) {
      throw new LinkDocumentationError(400, "Only a documentation-only Project can be linked");
    }
    const target = locked.find((row) => row.id === targetId);
    if (!target) throw new LinkDocumentationError(404, "Project not found");
    // Documentation-only covers the source itself.
    if (target.isDocumentationOnly || !isDeliveryProject(target)) {
      throw new LinkDocumentationError(400, "Documents can only move to a Client Project or an Internal Project");
    }
    const from = source.projectId;
    const to = target.projectId;

    // Documents before Projects, the order a Document save takes them in. The
    // Project lock then waits for pages and Files still being added.
    await tx
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.projectId, from), inWorkspace(documents)))
      .orderBy(asc(documents.id))
      .for("no key update");
    await tx
      .select({ id: projects.id })
      .from(projects)
      .where(and(inArray(projects.id, [from, to]), inWorkspace(projects)))
      .orderBy(asc(projects.id))
      .for("update");

    const movedDocuments = await tx.execute(sql`
      WITH roots AS (
        SELECT id, row_number() OVER (ORDER BY position, created_at, id) AS rank
          FROM documents
         WHERE project_id = ${from} AND parent_id IS NULL AND workspace_id = ${workspaceId}
      ), existing AS (
        SELECT coalesce(max(position), -1) AS last
          FROM documents
         WHERE project_id = ${to} AND parent_id IS NULL AND workspace_id = ${workspaceId}
      )
      UPDATE documents d
         SET project_id = ${to},
             position = coalesce(
               (SELECT existing.last + roots.rank FROM roots, existing WHERE roots.id = d.id),
               d.position
             )
       WHERE d.project_id = ${from} AND d.workspace_id = ${workspaceId}
      RETURNING d.id
    `);
    const movedFiles = await tx
      .update(files)
      .set({ projectId: to })
      .where(and(eq(files.projectId, from), inWorkspace(files)))
      .returning({ id: files.id });
    await syncDocumentProjectRows(tx, sql`d.project_id = ${to}`);

    const now = new Date();
    await tx
      .update(crmProjects)
      .set({ documentationEnabled: 1, updatedAt: now })
      .where(and(eq(crmProjects.id, targetId), inWorkspace(crmProjects)));
    await tx
      .update(crmProjects)
      .set({ documentationEnabled: 0, updatedAt: now })
      .where(and(eq(crmProjects.id, sourceId), inWorkspace(crmProjects)));
    await tx
      .update(projects)
      .set({ updatedAt: now })
      .where(and(inArray(projects.id, [from, to]), inWorkspace(projects)));

    const counts = { documents: movedDocuments.rows.length, files: movedFiles.length };
    await tx.insert(auditEvents).values(
      stampWorkspace({
        actorKind: "user" as const,
        actorId,
        action: "documentation.linked",
        resourceType: "crm_projects",
        resourceId: sourceId,
        payload: { from: sourceId, to: targetId, ...counts },
      }),
    );
    return { targetId, ...counts };
  });
}

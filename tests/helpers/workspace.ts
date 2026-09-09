import {
  memberships,
  PARALLEL_WORKSPACE_ID,
  SEEDED_WORKSPACE_ID,
  workspaceBilling,
  workspaceRoles,
  workspaces,
} from "../../shared/schema";
import { runWithWorkspaceContext } from "../../server/workspaceContext";

/** Run repository work as the seeded Workspace — the only production Membership. */
export function inSeededWorkspace<T>(fn: () => T): T {
  return runWithWorkspaceContext({ workspaceId: SEEDED_WORKSPACE_ID }, fn);
}

/**
 * A second Workspace so Active Workspace switching can be demonstrated (#183).
 * Catalog only — callers add Memberships explicitly.
 */
export async function plantParallelWorkspace(name = "Harbour View"): Promise<string> {
  const { db } = await import("../../server/db");
  await db.insert(workspaces).values({ id: PARALLEL_WORKSPACE_ID, name }).onConflictDoNothing();
  await db
    .insert(workspaceRoles)
    .values([
      { id: `${PARALLEL_WORKSPACE_ID}-owner`, workspaceId: PARALLEL_WORKSPACE_ID, slug: "owner", name: "Owner" },
      {
        id: `${PARALLEL_WORKSPACE_ID}-administrator`,
        workspaceId: PARALLEL_WORKSPACE_ID,
        slug: "administrator",
        name: "Administrator",
      },
      { id: `${PARALLEL_WORKSPACE_ID}-member`, workspaceId: PARALLEL_WORKSPACE_ID, slug: "member", name: "Member" },
    ])
    .onConflictDoNothing();
  await db
    .insert(workspaceBilling)
    .values({
      workspaceId: PARALLEL_WORKSPACE_ID,
      planKey: "legacy",
      registryVersion: 1,
      billingState: "Active",
      purchasedSeatCapacity: 500,
      authorizationVersion: 1,
    })
    .onConflictDoNothing();
  return PARALLEL_WORKSPACE_ID;
}

export async function addWorkspaceMembership(
  userId: string,
  workspaceId: string,
  slug: "owner" | "administrator" | "member" = "member",
  archived = false,
): Promise<void> {
  const { db } = await import("../../server/db");
  await db.insert(memberships).values({
    workspaceId,
    userId,
    workspaceRoleId: `${workspaceId}-${slug}`,
    archivedAt: archived ? new Date() : null,
  });
}

import {
  memberships,
  PARALLEL_WORKSPACE_ID,
  SEEDED_WORKSPACE_ID,
  workspaceBilling,
  workspaceRoles,
  workspaces,
  type InsertUser,
  type User,
} from "../../shared/schema";
import { runWithWorkspaceContext } from "../../server/workspaceContext";
import { ownerDb } from "./db";

/** Run repository work as the seeded Workspace — the only production Membership. */
export function inSeededWorkspace<T>(fn: () => T): T {
  return runWithWorkspaceContext({ workspaceId: SEEDED_WORKSPACE_ID }, fn);
}

/** Fixtures below write as the database owner: they span Workspaces, outside any context (#323). */

/**
 * A second Workspace so Active Workspace switching can be demonstrated (#183).
 * Catalog only — callers add Memberships explicitly.
 */
export async function plantParallelWorkspace(name = "Harbour View"): Promise<string> {
  await ownerDb.insert(workspaces).values({ id: PARALLEL_WORKSPACE_ID, name }).onConflictDoNothing();
  await ownerDb
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
  await ownerDb
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
  await ownerDb.insert(memberships).values({
    workspaceId,
    userId,
    workspaceRoleId: `${workspaceId}-${slug}`,
    archivedAt: archived ? new Date() : null,
  });
}

/**
 * A User with a Member Membership in the seeded Workspace. `createUser` joins
 * no Workspace (#297), so suites that need a Member add the Membership here.
 */
export async function createSeededMember(userData: InsertUser): Promise<User> {
  const { storage } = await import("../../server/storage");
  const user = await storage.createUser(userData);
  await addWorkspaceMembership(user.id, SEEDED_WORKSPACE_ID, "member", Boolean(user.isArchived));
  return user;
}

/** Strip every Membership from a User — the state Flow 1 starts from. */
export async function removeAllMemberships(userId: string): Promise<void> {
  const { eq } = await import("drizzle-orm");
  await ownerDb.delete(memberships).where(eq(memberships.userId, userId));
}

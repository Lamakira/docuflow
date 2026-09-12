/**
 * Active Workspace preference (#183). Listing Memberships and setting the
 * preference cannot be composed from existing `/api/*` — those reads are
 * already bound to one Workspace. This is a User-global surface.
 */

import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import {
  capabilities,
  membershipCapabilities,
  memberships,
  users,
  workspaceBilling,
  workspaceRoleCapabilities,
  workspaceRoles,
  workspaces,
} from "@shared/schema";
import { db } from "../../db";
import { inWorkspace, requireWorkspaceContext } from "../../workspaceContext";

export type WorkspaceCondition = "Trial" | "Read-only" | "Past due" | null;

export type MembershipView = {
  workspaceId: string;
  workspaceName: string;
  workspaceRole: string;
  condition: WorkspaceCondition;
};

export type MembershipsResponse = {
  activeWorkspaceId: string;
  preferredWorkspaceId: string | null;
  memberships: MembershipView[];
};

export class InvalidActiveWorkspaceError extends Error {
  readonly statusCode = 400;

  constructor() {
    super("No active Membership in that Workspace");
    this.name = "InvalidActiveWorkspaceError";
  }
}

export function workspaceCondition(billingState: string | null | undefined): WorkspaceCondition {
  if (billingState === "Trialing") return "Trial";
  if (billingState === "ReadOnly") return "Read-only";
  if (billingState === "PastDue") return "Past due";
  return null;
}

export function membershipRoleLabel(slug: string): string {
  if (slug === "owner") return "OWNER";
  if (slug === "administrator") return "ADMINISTRATOR";
  return "MEMBER";
}

function sortMemberships(rows: MembershipView[], activeWorkspaceId: string): MembershipView[] {
  return [...rows].sort((a, b) => {
    if (a.workspaceId === activeWorkspaceId) return -1;
    if (b.workspaceId === activeWorkspaceId) return 1;
    return a.workspaceName.localeCompare(b.workspaceName);
  });
}

async function loadMemberships(userId: string): Promise<{
  preferredWorkspaceId: string | null;
  memberships: MembershipView[];
}> {
  const [user] = await db
    .select({ activeWorkspaceId: users.activeWorkspaceId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const rows = await db
    .select({
      workspaceId: memberships.workspaceId,
      workspaceName: workspaces.name,
      slug: workspaceRoles.slug,
      billingState: workspaceBilling.billingState,
    })
    .from(memberships)
    .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
    .innerJoin(workspaceRoles, eq(workspaceRoles.id, memberships.workspaceRoleId))
    .leftJoin(workspaceBilling, eq(workspaceBilling.workspaceId, memberships.workspaceId))
    .where(and(eq(memberships.userId, userId), isNull(memberships.archivedAt)));

  return {
    preferredWorkspaceId: user?.activeWorkspaceId ?? null,
    memberships: rows.map((row) => ({
      workspaceId: row.workspaceId,
      workspaceName: row.workspaceName,
      workspaceRole: membershipRoleLabel(row.slug),
      condition: workspaceCondition(row.billingState),
    })),
  };
}

export async function listMemberships(userId: string): Promise<MembershipsResponse> {
  const activeWorkspaceId = requireWorkspaceContext().workspaceId;
  const loaded = await loadMemberships(userId);
  return {
    activeWorkspaceId,
    preferredWorkspaceId: loaded.preferredWorkspaceId,
    memberships: sortMemberships(loaded.memberships, activeWorkspaceId),
  };
}

export type WorkspacePersonView = {
  membershipId: string;
  userId: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  workspaceRole: string;
  capabilities: string[];
  archived: boolean;
  hoursPerDay: number;
  canViewDailyUpdates: number;
};

export type WorkspaceMembershipsResponse = {
  memberships: WorkspacePersonView[];
};

/**
 * Memberships in the Active Workspace (#192). GET /api/users is global and
 * does not carry Workspace Role or Capabilities, so this cannot be composed.
 */
export async function listWorkspaceMemberships(
  requesterUserId: string,
  includeArchivedQuery: boolean,
): Promise<WorkspaceMembershipsResponse> {
  const [requester] = await db
    .select({ slug: workspaceRoles.slug })
    .from(memberships)
    .innerJoin(workspaceRoles, eq(workspaceRoles.id, memberships.workspaceRoleId))
    .where(
      and(
        inWorkspace(memberships),
        eq(memberships.userId, requesterUserId),
        isNull(memberships.archivedAt),
      ),
    )
    .limit(1);
  const canReviewArchived = requester?.slug === "owner" || requester?.slug === "administrator";
  const includeArchived = includeArchivedQuery && canReviewArchived;

  const rows = await db
    .select({
      membershipId: memberships.id,
      userId: memberships.userId,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
      hoursPerDay: users.hoursPerDay,
      canViewDailyUpdates: users.canViewDailyUpdates,
      archivedAt: memberships.archivedAt,
      slug: workspaceRoles.slug,
      workspaceRoleId: memberships.workspaceRoleId,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .innerJoin(workspaceRoles, eq(workspaceRoles.id, memberships.workspaceRoleId))
    .where(
      includeArchived
        ? inWorkspace(memberships)
        : and(inWorkspace(memberships), isNull(memberships.archivedAt)),
    )
    .orderBy(asc(users.firstName), asc(users.lastName), asc(users.email));

  const roleIds = [...new Set(rows.map((row) => row.workspaceRoleId))];
  const membershipIds = rows.map((row) => row.membershipId);

  const roleCaps =
    roleIds.length === 0
      ? []
      : await db
          .select({
            workspaceRoleId: workspaceRoleCapabilities.workspaceRoleId,
            name: capabilities.name,
          })
          .from(workspaceRoleCapabilities)
          .innerJoin(capabilities, eq(capabilities.id, workspaceRoleCapabilities.capabilityId))
          .where(
            and(
              inWorkspace(workspaceRoleCapabilities),
              inArray(workspaceRoleCapabilities.workspaceRoleId, roleIds),
            ),
          );

  const extraCaps =
    membershipIds.length === 0
      ? []
      : await db
          .select({
            membershipId: membershipCapabilities.membershipId,
            name: capabilities.name,
          })
          .from(membershipCapabilities)
          .innerJoin(capabilities, eq(capabilities.id, membershipCapabilities.capabilityId))
          .where(
            and(
              inWorkspace(membershipCapabilities),
              inArray(membershipCapabilities.membershipId, membershipIds),
            ),
          );

  const roleCapMap = new Map<string, string[]>();
  for (const cap of roleCaps) pushUnique(roleCapMap, cap.workspaceRoleId, cap.name);
  const extraCapMap = new Map<string, string[]>();
  for (const cap of extraCaps) pushUnique(extraCapMap, cap.membershipId, cap.name);

  return {
    memberships: rows.map((row) => {
      const names = [
        ...(roleCapMap.get(row.workspaceRoleId) ?? []),
        ...(extraCapMap.get(row.membershipId) ?? []),
      ];
      return {
        membershipId: row.membershipId,
        userId: row.userId,
        firstName: row.firstName,
        lastName: row.lastName,
        email: row.email,
        workspaceRole: membershipRoleLabel(row.slug),
        capabilities: [...new Set(names)].sort((a, b) => a.localeCompare(b)),
        archived: row.archivedAt != null,
        hoursPerDay: row.hoursPerDay,
        canViewDailyUpdates: row.canViewDailyUpdates,
      };
    }),
  };
}

function pushUnique(map: Map<string, string[]>, key: string, name: string): void {
  const list = map.get(key) ?? [];
  if (!list.includes(name)) list.push(name);
  map.set(key, list);
}

export async function setActiveWorkspace(
  userId: string,
  workspaceId: string,
): Promise<MembershipsResponse> {
  const [membership] = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, userId),
        eq(memberships.workspaceId, workspaceId),
        isNull(memberships.archivedAt),
      ),
    )
    .limit(1);
  if (!membership) throw new InvalidActiveWorkspaceError();

  await db
    .update(users)
    .set({ activeWorkspaceId: workspaceId, updatedAt: new Date() })
    .where(eq(users.id, userId));

  const loaded = await loadMemberships(userId);
  return {
    activeWorkspaceId: workspaceId,
    preferredWorkspaceId: workspaceId,
    memberships: sortMemberships(loaded.memberships, workspaceId),
  };
}

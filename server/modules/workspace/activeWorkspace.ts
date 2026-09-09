/**
 * Active Workspace preference (#183). Listing Memberships and setting the
 * preference cannot be composed from existing `/api/*` — those reads are
 * already bound to one Workspace. This is a User-global surface.
 */

import { and, eq, isNull } from "drizzle-orm";
import {
  memberships,
  users,
  workspaceBilling,
  workspaceRoles,
  workspaces,
} from "@shared/schema";
import { db } from "../../db";
import { requireWorkspaceContext } from "../../workspaceContext";

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

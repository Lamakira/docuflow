/**
 * Who may administer the Workspace this request entered (#238).
 *
 * The Workspace Role is the authority. The global `users.role` column is the
 * single-tenant era's and carries none: a Workspace created through #217 leaves
 * its Owner on `role = 'user'`, so a column check refuses the one Membership
 * GLOSSARY.md calls the ultimate authority over that Workspace.
 *
 * Administration is not a Capability. `capabilities` holds one member-facing
 * grant (`view_daily_updates`) and the Public API grants Service Accounts
 * carry — no row exists that could be granted for this, so a refusal must not
 * offer one.
 */

import type { RequestHandler } from "express";
import { and, eq } from "drizzle-orm";
import {
  VIEW_DAILY_UPDATES_CAPABILITY_ID,
  membershipCapabilities,
  memberships,
  workspaceRoles,
} from "@shared/schema";
import { db } from "./db";
import {
  ArchivedMembershipError,
  NoActiveMembershipError,
  contextFromUser,
  currentWorkspaceContext,
  inWorkspace,
  runWithWorkspaceContext,
} from "./workspaceContext";

/** The Workspace Role slug on the Membership this request entered on. */
export async function currentWorkspaceRoleSlug(): Promise<string | null> {
  const ctx = currentWorkspaceContext();
  if (!ctx?.membershipId) return null;
  const [row] = await db
    .select({ slug: workspaceRoles.slug })
    .from(memberships)
    .innerJoin(workspaceRoles, eq(memberships.workspaceRoleId, workspaceRoles.id))
    .where(eq(memberships.id, ctx.membershipId));
  return row?.slug ?? null;
}

/** Owner and Administrator govern Administration. Member does not. */
export async function canManageAdministration(): Promise<boolean> {
  const slug = await currentWorkspaceRoleSlug();
  return slug === "owner" || slug === "administrator";
}

/**
 * The gate every Administration route shares. `{ message }` on the wire, as the
 * rest of `/api/*` does; the copy a customer reads is composed in the client,
 * where the Workspace Role that was refused is known.
 */
export const requireAdministration: RequestHandler = async (_req, res, next) => {
  if (!(await canManageAdministration())) {
    return res.status(403).json({ message: "Access denied" });
  }
  next();
};

export class MembershipManagementError extends Error {
  readonly statusCode = 403;
  constructor(message: string) {
    super(message);
    this.name = "MembershipManagementError";
  }
}

type RoleHolder = { membershipId: string; slug: string | null };

/**
 * Who may change, archive or restore whose Membership. The refusal to make, or
 * null when the actor may act on the target.
 */
export function membershipRefusal(actor: RoleHolder, target: RoleHolder): MembershipManagementError | null {
  if (actor.slug !== "owner" && actor.slug !== "administrator") {
    return new MembershipManagementError("Access denied");
  }
  if (actor.membershipId === target.membershipId) {
    return new MembershipManagementError("You cannot change your own Membership");
  }
  if (target.slug === "owner") {
    return new MembershipManagementError("The Owner's Membership cannot be changed here");
  }
  if (actor.slug !== "owner" && target.slug !== "member") {
    return new MembershipManagementError("Only the Owner can manage an Administrator");
  }
  return null;
}

/**
 * Whether the Membership this request entered on reads Daily Updates: an Owner
 * or Administrator, or a Member granted the Capability on this Membership.
 */
export async function canViewDailyUpdates(): Promise<boolean> {
  const ctx = currentWorkspaceContext();
  if (!ctx?.membershipId) return false;
  if (await canManageAdministration()) return true;
  const [grant] = await db
    .select({ id: membershipCapabilities.id })
    .from(membershipCapabilities)
    .where(
      and(
        inWorkspace(membershipCapabilities),
        eq(membershipCapabilities.membershipId, ctx.membershipId),
        eq(membershipCapabilities.capabilityId, VIEW_DAILY_UPDATES_CAPABILITY_ID),
      ),
    )
    .limit(1);
  return grant !== undefined;
}

/** The same answer for a session that entered no Workspace yet: its Active Workspace's, 0 without one. */
export async function dailyUpdatesAccessOf(userId: string): Promise<0 | 1> {
  try {
    const ctx = await contextFromUser(userId);
    return (await runWithWorkspaceContext(ctx, () => canViewDailyUpdates())) ? 1 : 0;
  } catch (error) {
    if (error instanceof ArchivedMembershipError || error instanceof NoActiveMembershipError) return 0;
    throw error;
  }
}

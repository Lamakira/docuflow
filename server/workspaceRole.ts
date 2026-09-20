/**
 * Who may administer the Workspace this request entered (#238).
 *
 * The Workspace Role is the authority. The global `users.role` column is the
 * single-tenant era's and carries none: a Workspace created through #217 leaves
 * its Owner on `role = 'user'`, so a column check refuses the one Membership
 * CONTEXT.md calls the ultimate authority over that Workspace.
 *
 * Administration is not a Capability. `capabilities` holds one member-facing
 * grant (`view_daily_updates`) and the Public API grants Service Accounts
 * carry — no row exists that could be granted for this, so a refusal must not
 * offer one.
 */

import type { RequestHandler } from "express";
import { and, eq } from "drizzle-orm";
import { memberships, workspaceRoles } from "@shared/schema";
import { db } from "./db";
import { currentWorkspaceContext } from "./workspaceContext";

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

/**
 * The platform directory's promote and demote move the Workspace Role with the
 * global column, so a promotion lands where Administration actually authorizes.
 *
 * Only the two Roles the column maps onto are touched. An Owner is never
 * demoted — ownership is transferred, not taken by a role write (CONTEXT.md) —
 * and a custom Workspace Role is not overwritten by a platform-level promotion.
 * With no Workspace entered there is nothing to align, and nothing is guessed.
 */
export async function alignWorkspaceRoleToGlobalRole(userId: string, role: string): Promise<void> {
  const ctx = currentWorkspaceContext();
  if (!ctx) return;
  const { workspaceId } = ctx;
  const wanted = role === "admin" ? "administrator" : "member";

  const [current] = await db
    .select({ id: memberships.id, slug: workspaceRoles.slug })
    .from(memberships)
    .innerJoin(workspaceRoles, eq(workspaceRoles.id, memberships.workspaceRoleId))
    .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, userId)))
    .limit(1);
  if (!current) return;
  if (current.slug !== "administrator" && current.slug !== "member") return;
  if (current.slug === wanted) return;

  const [target] = await db
    .select({ id: workspaceRoles.id })
    .from(workspaceRoles)
    .where(and(eq(workspaceRoles.workspaceId, workspaceId), eq(workspaceRoles.slug, wanted)))
    .limit(1);
  // A Workspace without its built-in Roles is corrupt, not a case to invent one for.
  if (!target) return;

  await db
    .update(memberships)
    .set({ workspaceRoleId: target.id, updatedAt: new Date() })
    .where(eq(memberships.id, current.id));
}

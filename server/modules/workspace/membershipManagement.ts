/**
 * What a manager does to another Membership (F84, F86, F88): its Workspace Role,
 * the Daily Updates grant, archive and restore. One Workspace's Membership only;
 * the account is the platform's (`archiveUser`).
 *
 * Every act decides under lock, in one transaction: the actor's own Membership
 * and the target are locked together, so a role changed or a Membership archived
 * meanwhile is seen before anything is written.
 */

import { and, asc, eq, inArray } from "drizzle-orm";
import {
  VIEW_DAILY_UPDATES_CAPABILITY_ID,
  auditEvents,
  membershipCapabilities,
  memberships,
  users,
  workspaceRoles,
} from "@shared/schema";
import { db } from "../../db";
import { inWorkspace, requireWorkspaceContext, stampWorkspace } from "../../workspaceContext";
import { membershipRefusal } from "../../workspaceRole";
import { assertSeatAvailable, lockSeats } from "../billing/seats";
import { membershipRoleLabel } from "./activeWorkspace";

export class MembershipNotFoundError extends Error {
  readonly statusCode = 404;
  constructor() {
    super("Membership not found");
    this.name = "MembershipNotFoundError";
  }
}

export class AccountArchivedError extends Error {
  readonly statusCode = 409;
  constructor() {
    super("This account is archived. Contact DocuFlow support to restore it.");
    this.name = "AccountArchivedError";
  }
}

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** An id or token Postgres can be asked about: a NUL is an error there, not a miss. */
export function isLookupKey(key: string): boolean {
  return key.length > 0 && key.length <= 64 && !key.includes("\0");
}

type ManagedMembership = {
  id: string;
  userId: string;
  workspaceRoleId: string;
  slug: string;
  archivedAt: Date | null;
};

/** The target, locked with the actor's own Membership, once this actor may act on it. */
export async function lockManaged(
  tx: Tx,
  membershipId: string,
  actorId: string = requireWorkspaceContext().membershipId ?? "",
): Promise<ManagedMembership> {
  // Roles are read apart: a row that changed while this waited for its lock
  // would no longer match a role joined before the wait.
  const rows = await tx
    .select({
      id: memberships.id,
      userId: memberships.userId,
      workspaceRoleId: memberships.workspaceRoleId,
      archivedAt: memberships.archivedAt,
    })
    .from(memberships)
    .where(and(inWorkspace(memberships), inArray(memberships.id, [actorId, membershipId])))
    .orderBy(asc(memberships.id))
    .for("update");
  const roles = await tx
    .select({ id: workspaceRoles.id, slug: workspaceRoles.slug })
    .from(workspaceRoles)
    .where(inWorkspace(workspaceRoles));
  const slugOf = (roleId: string) => roles.find((role) => role.id === roleId)?.slug ?? "";

  const target = rows.find((row) => row.id === membershipId);
  if (!target) throw new MembershipNotFoundError();
  const actor = rows.find((row) => row.id === actorId && row.archivedAt === null);
  const slug = slugOf(target.workspaceRoleId);
  const refusal = membershipRefusal(
    { membershipId: actorId, slug: actor ? slugOf(actor.workspaceRoleId) : null },
    { membershipId, slug },
  );
  if (refusal) throw refusal;
  return { ...target, slug };
}

export async function recordMembershipEvent(
  tx: Tx,
  actorUserId: string,
  event: {
    action: string;
    resourceType: "memberships" | "invitations";
    resourceId: string;
    payload: Record<string, unknown>;
    createdAt?: Date;
  },
): Promise<void> {
  await tx.insert(auditEvents).values(
    stampWorkspace({ actorKind: "user" as const, actorId: actorUserId, ...event }),
  );
}

/** Whether the grant changed. */
export async function setDailyUpdatesGrant(
  tx: Pick<Tx, "insert" | "delete">,
  membershipId: string,
  granted: boolean,
): Promise<boolean> {
  if (granted) {
    const added = await tx
      .insert(membershipCapabilities)
      .values(stampWorkspace({ membershipId, capabilityId: VIEW_DAILY_UPDATES_CAPABILITY_ID }))
      .onConflictDoNothing()
      .returning({ id: membershipCapabilities.id });
    return added.length > 0;
  }
  const removed = await tx
    .delete(membershipCapabilities)
    .where(
      and(
        inWorkspace(membershipCapabilities),
        eq(membershipCapabilities.membershipId, membershipId),
        eq(membershipCapabilities.capabilityId, VIEW_DAILY_UPDATES_CAPABILITY_ID),
      ),
    )
    .returning({ id: membershipCapabilities.id });
  return removed.length > 0;
}

export type ManagedMembershipView = {
  membershipId: string;
  userId: string;
  workspaceRole: string;
  canViewDailyUpdates: 0 | 1;
};

export async function updateMembership(
  actorUserId: string,
  membershipId: string,
  patch: { workspaceRole?: "MEMBER" | "ADMINISTRATOR"; canViewDailyUpdates?: 0 | 1 },
): Promise<ManagedMembershipView> {
  if (!isLookupKey(membershipId)) throw new MembershipNotFoundError();
  return db.transaction(async (tx) => {
    const target = await lockManaged(tx, membershipId);
    if (target.archivedAt) throw new MembershipNotFoundError();
    const from = membershipRoleLabel(target.slug);
    const event = { resourceType: "memberships" as const, resourceId: membershipId };

    if (patch.workspaceRole && patch.workspaceRole !== from) {
      const [role] = await tx
        .select({ id: workspaceRoles.id })
        .from(workspaceRoles)
        .where(and(inWorkspace(workspaceRoles), eq(workspaceRoles.slug, patch.workspaceRole.toLowerCase())))
        .limit(1);
      if (!role) throw new Error(`Workspace has no ${patch.workspaceRole} Role`);
      await tx
        .update(memberships)
        .set({ workspaceRoleId: role.id, updatedAt: new Date() })
        .where(and(inWorkspace(memberships), eq(memberships.id, membershipId)));
      await recordMembershipEvent(tx, actorUserId, {
        ...event,
        action: "membership.role_changed",
        payload: { from, to: patch.workspaceRole },
      });
    }

    if (patch.canViewDailyUpdates !== undefined) {
      const granted = patch.canViewDailyUpdates === 1;
      if (await setDailyUpdatesGrant(tx, membershipId, granted)) {
        await recordMembershipEvent(tx, actorUserId, {
          ...event,
          action: granted ? "membership.daily_updates_granted" : "membership.daily_updates_revoked",
          payload: {},
        });
      }
    }

    const [grant] = await tx
      .select({ id: membershipCapabilities.id })
      .from(membershipCapabilities)
      .where(
        and(
          inWorkspace(membershipCapabilities),
          eq(membershipCapabilities.membershipId, membershipId),
          eq(membershipCapabilities.capabilityId, VIEW_DAILY_UPDATES_CAPABILITY_ID),
        ),
      )
      .limit(1);
    return {
      membershipId,
      userId: target.userId,
      workspaceRole: patch.workspaceRole ?? from,
      canViewDailyUpdates: grant ? 1 : 0,
    };
  });
}

export async function archiveMembership(
  actorUserId: string,
  membershipId: string,
): Promise<{ membershipId: string; archived: true }> {
  if (!isLookupKey(membershipId)) throw new MembershipNotFoundError();
  return db.transaction(async (tx) => {
    const target = await lockManaged(tx, membershipId);
    if (!target.archivedAt) {
      const now = new Date();
      await tx
        .update(memberships)
        .set({ archivedAt: now, updatedAt: now })
        .where(and(inWorkspace(memberships), eq(memberships.id, membershipId)));
      // The same instant on both rows: `archivedWithAccount` tells this archive
      // from the account's by it.
      await recordMembershipEvent(tx, actorUserId, {
        action: "membership.archived",
        resourceType: "memberships",
        resourceId: membershipId,
        payload: {},
        createdAt: now,
      });
    }
    return { membershipId, archived: true };
  });
}

export async function restoreMembership(
  actorUserId: string,
  membershipId: string,
): Promise<{ membershipId: string; archived: false }> {
  if (!isLookupKey(membershipId)) throw new MembershipNotFoundError();
  return db.transaction(async (tx) => {
    // Seats, then the account, then the Memberships: the order acceptance and
    // the account's own restore lock them in.
    await lockSeats(tx);
    const [located] = await tx
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(and(inWorkspace(memberships), eq(memberships.id, membershipId)))
      .limit(1);
    if (!located) throw new MembershipNotFoundError();
    const [account] = await tx
      .select({ isArchived: users.isArchived })
      .from(users)
      .where(eq(users.id, located.userId))
      .for("update");
    const target = await lockManaged(tx, membershipId);
    if (target.archivedAt) {
      if (account?.isArchived) throw new AccountArchivedError();
      await assertSeatAvailable(tx);
      await tx
        .update(memberships)
        .set({ archivedAt: null, updatedAt: new Date() })
        .where(and(inWorkspace(memberships), eq(memberships.id, membershipId)));
      await recordMembershipEvent(tx, actorUserId, {
        action: "membership.restored",
        resourceType: "memberships",
        resourceId: membershipId,
        payload: {},
      });
    }
    return { membershipId, archived: false };
  });
}

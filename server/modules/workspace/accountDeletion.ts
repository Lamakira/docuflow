/**
 * Account deletion (#217, Flow 10, ADR-0015).
 *
 * Guided, reversible for a window, and deliberately not immediate. Every owned
 * Workspace must be transferred or deleted first — that is a precondition, not
 * a warning. On completion, controller-side data is erased and Memberships are
 * pseudonymized in place, so the operational and audit records the Workspaces
 * own keep their references. DocuFlow is processor for Workspace content: an
 * Owner leaving does not take their colleagues' recorded time with them.
 */

import { and, asc, eq, inArray, isNull, lte, ne } from "drizzle-orm";
import {
  accountDeletions,
  auditEvents,
  memberships,
  notifications,
  users,
  workspaceRoles,
  workspaces,
} from "@shared/schema";
import { db } from "../../db";
import { runWithWorkspaceContext } from "../../workspaceContext";

/** `[Grace duration is a product decision — 30 days is the value in use.]` */
export const ACCOUNT_DELETION_GRACE_DAYS = 30;

export class OwnedWorkspaceRemainsError extends Error {
  readonly statusCode = 409;
  constructor() {
    super("Transfer or delete every Workspace you own before deleting your account");
    this.name = "OwnedWorkspaceRemainsError";
  }
}

export class AccountDeletionPendingError extends Error {
  readonly statusCode = 409;
  constructor() {
    super("Your account is already scheduled for deletion");
    this.name = "AccountDeletionPendingError";
  }
}

export class NoAccountDeletionError extends Error {
  readonly statusCode = 404;
  constructor() {
    super("No deletion is scheduled");
    this.name = "NoAccountDeletionError";
  }
}

export type OwnedWorkspaceView = {
  workspaceId: string;
  workspaceName: string;
  otherActiveMembers: number;
  members: Array<{ userId: string; name: string }>;
};

export type AccountDeletionView = {
  ownedWorkspaces: OwnedWorkspaceView[];
  scheduled: { requestedAt: Date; completesAt: Date } | null;
  gracePeriodDays: number;
};

function displayName(row: { firstName: string | null; lastName: string | null; email: string }): string {
  const named = [row.firstName, row.lastName].filter(Boolean).join(" ").trim();
  return named.length > 0 ? named : row.email;
}

async function ownedWorkspaces(userId: string): Promise<OwnedWorkspaceView[]> {
  const owned = await db
    .select({ workspaceId: memberships.workspaceId, workspaceName: workspaces.name })
    .from(memberships)
    .innerJoin(workspaceRoles, eq(workspaceRoles.id, memberships.workspaceRoleId))
    .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
    .where(
      and(
        eq(memberships.userId, userId),
        isNull(memberships.archivedAt),
        eq(workspaceRoles.slug, "owner"),
      ),
    )
    .orderBy(asc(workspaces.name));
  if (owned.length === 0) return [];

  const colleagues = await db
    .select({
      workspaceId: memberships.workspaceId,
      userId: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        inArray(
          memberships.workspaceId,
          owned.map((row) => row.workspaceId),
        ),
        ne(memberships.userId, userId),
        isNull(memberships.archivedAt),
      ),
    )
    .orderBy(asc(users.firstName), asc(users.lastName), asc(users.email));

  return owned.map((workspace) => {
    const members = colleagues
      .filter((row) => row.workspaceId === workspace.workspaceId)
      .map((row) => ({ userId: row.userId, name: displayName(row) }));
    return {
      workspaceId: workspace.workspaceId,
      workspaceName: workspace.workspaceName,
      otherActiveMembers: members.length,
      members,
    };
  });
}

async function pendingDeletion(userId: string) {
  const [row] = await db
    .select()
    .from(accountDeletions)
    .where(and(eq(accountDeletions.userId, userId), eq(accountDeletions.status, "pending")))
    .limit(1);
  return row;
}

export async function accountDeletionState(userId: string): Promise<AccountDeletionView> {
  const pending = await pendingDeletion(userId);
  return {
    ownedWorkspaces: await ownedWorkspaces(userId),
    scheduled: pending ? { requestedAt: pending.requestedAt, completesAt: pending.completesAt } : null,
    gracePeriodDays: ACCOUNT_DELETION_GRACE_DAYS,
  };
}

function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}

export async function requestAccountDeletion(
  userId: string,
  options: { now?: Date } = {},
): Promise<{ requestedAt: Date; completesAt: Date; gracePeriodDays: number }> {
  if (await pendingDeletion(userId)) throw new AccountDeletionPendingError();
  const owned = await ownedWorkspaces(userId);
  if (owned.length > 0) throw new OwnedWorkspaceRemainsError();

  const requestedAt = options.now ?? new Date();
  const completesAt = addDays(requestedAt, ACCOUNT_DELETION_GRACE_DAYS);

  const [row] = await db
    .insert(accountDeletions)
    .values({ userId, status: "pending", requestedAt, completesAt })
    .returning();

  await recordAcrossWorkspaces(userId, "account.deletion_requested", {
    completesAt: completesAt.toISOString(),
  });

  return {
    requestedAt: row.requestedAt,
    completesAt: row.completesAt,
    gracePeriodDays: ACCOUNT_DELETION_GRACE_DAYS,
  };
}

export async function cancelAccountDeletion(userId: string): Promise<{ scheduled: null }> {
  const pending = await pendingDeletion(userId);
  if (!pending) throw new NoAccountDeletionError();

  await db
    .update(accountDeletions)
    .set({ status: "canceled", canceledAt: new Date(), updatedAt: new Date() })
    .where(eq(accountDeletions.id, pending.id));

  await recordAcrossWorkspaces(userId, "account.deletion_canceled", {});
  return { scheduled: null };
}

/**
 * One Audit Event per Workspace this User belongs to. Audit is Workspace-scoped
 * (ADR-0015), and an account event is visible evidence in each of them.
 */
async function recordAcrossWorkspaces(
  userId: string,
  action: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const rows = await db
    .select({ workspaceId: memberships.workspaceId })
    .from(memberships)
    .where(eq(memberships.userId, userId));
  const workspaceIds = [...new Set(rows.map((row) => row.workspaceId))];

  // One write per Workspace, inside that Workspace's context: `audit_events` is
  // RLS-scoped, and a write with no `app.workspace_id` fails closed once the
  // application role is in use (migration 0010).
  for (const workspaceId of workspaceIds) {
    await runWithWorkspaceContext({ workspaceId }, () =>
      db.insert(auditEvents).values({
        workspaceId,
        actorKind: "user" as const,
        actorId: userId,
        action,
        resourceType: "users",
        resourceId: userId,
        payload,
      }),
    );
  }
}

/** The address a pseudonymized User keeps — unique, unroutable, and obvious. */
export function pseudonymEmail(userId: string): string {
  return `deleted-${userId}@deleted.invalid`;
}

/**
 * Complete every grace window that has run out. Idempotent by design: it only
 * ever reads `pending` rows and marks them `completed`, so a second pass over
 * the same instant does nothing. Scheduled from the Worker.
 */
export async function completeDueAccountDeletions(now: Date = new Date()): Promise<number> {
  const due = await db
    .select()
    .from(accountDeletions)
    .where(and(eq(accountDeletions.status, "pending"), lte(accountDeletions.completesAt, now)));

  let completed = 0;
  for (const request of due) {
    await eraseAccount(request.userId, request.id, now);
    completed += 1;
  }
  return completed;
}

async function eraseAccount(userId: string, requestId: string, now: Date): Promise<void> {
  const held = await db
    .select({ workspaceId: memberships.workspaceId })
    .from(memberships)
    .where(eq(memberships.userId, userId));
  const workspaceIds = [...new Set(held.map((row) => row.workspaceId))];

  await db.transaction(async (tx) => {
    // Controller-side identity goes; the Membership rows stay so Workspace
    // records that reference them keep working.
    await tx
      .update(users)
      .set({
        email: pseudonymEmail(userId),
        firstName: null,
        lastName: null,
        profileImageUrl: null,
        identityProviderSubjectId: null,
        activeWorkspaceId: null,
        isArchived: true,
        updatedAt: now,
      })
      .where(eq(users.id, userId));

    await tx
      .update(accountDeletions)
      .set({ status: "completed", completedAt: now, updatedAt: now })
      .where(eq(accountDeletions.id, requestId));
  });

  // Memberships are pseudonymized in place, not removed: the Workspace records
  // that reference them are its own, and they keep working. Archiving each in
  // its Workspace's context keeps the write inside RLS.
  for (const workspaceId of workspaceIds) {
    await runWithWorkspaceContext({ workspaceId }, async () => {
      await db
        .update(memberships)
        .set({ archivedAt: now, updatedAt: now })
        .where(
          and(
            eq(memberships.userId, userId),
            eq(memberships.workspaceId, workspaceId),
            isNull(memberships.archivedAt),
          ),
        );
      await db.insert(auditEvents).values({
        workspaceId,
        actorKind: "system" as const,
        actorId: null,
        action: "account.erased",
        resourceType: "users",
        resourceId: userId,
        payload: { pseudonymized: true },
      });
    });
  }

  await notifyAffectedWorkspaces(userId, workspaceIds);
}

/**
 * Each affected Workspace is told (ADR-0015). The notice goes to the people who
 * answer for the Workspace — its Owner and Administrators — and says what did
 * not happen as plainly as what did.
 */
async function notifyAffectedWorkspaces(userId: string, workspaceIds: string[]): Promise<void> {
  if (workspaceIds.length === 0) return;

  const responsible = await db
    .select({ userId: memberships.userId, workspaceId: memberships.workspaceId })
    .from(memberships)
    .innerJoin(workspaceRoles, eq(workspaceRoles.id, memberships.workspaceRoleId))
    .where(
      and(
        inArray(memberships.workspaceId, workspaceIds),
        isNull(memberships.archivedAt),
        ne(memberships.userId, userId),
        inArray(workspaceRoles.slug, ["owner", "administrator"]),
      ),
    );
  if (responsible.length === 0) return;

  for (const workspaceId of workspaceIds) {
    const recipients = responsible.filter((row) => row.workspaceId === workspaceId);
    if (recipients.length === 0) continue;
    await runWithWorkspaceContext({ workspaceId }, () =>
      db.insert(notifications).values(
        recipients.map((row) => ({
          userId: row.userId,
          workspaceId,
          type: "account_deleted",
          message:
            "A Member deleted their DocuFlow account. Their recorded time, Activity Evidence, and Daily Updates stay in this Workspace under a pseudonym.",
        })),
      ),
    );
  }
}

/**
 * Platform Staff access to Workspace content (#300, ADR-0015).
 *
 * A grant is read-only and dies on its clock or when the Workspace revokes it.
 * Without one, the only read is break-glass: a written reason, an Audit Event,
 * and a notice to the Owner. Neither path is a session in the customer's name.
 */

import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  auditEvents,
  breakGlassAccess,
  memberships,
  notifications,
  orgSettings,
  platformStaff,
  supportAccessGrants,
  workspaceRoles,
  workspaces,
} from "@shared/schema";
import { db } from "../../db";
import { inWorkspace, runWithWorkspaceContext, stampWorkspace } from "../../workspaceContext";
import { currentWorkspaceRoleSlug } from "../../workspaceRole";
import { grantExpiresAt, GrantDurationError } from "./sessionClaims";

export { GrantDurationError };

export class OperatorAccessDeniedError extends Error {
  readonly statusCode = 403;
  constructor(message = "Access denied") {
    super(message);
    this.name = "OperatorAccessDeniedError";
  }
}

export class SupportAccessReadOnlyError extends Error {
  readonly statusCode = 403;
  constructor() {
    super("Support access is read-only");
    this.name = "SupportAccessReadOnlyError";
  }
}

export class BreakGlassReasonError extends Error {
  readonly statusCode = 400;
  constructor() {
    super("Break-glass access needs a written reason");
    this.name = "BreakGlassReasonError";
  }
}

export class PlatformStaffNotFoundError extends Error {
  readonly statusCode = 404;
  constructor() {
    super("Platform Staff was not found");
    this.name = "PlatformStaffNotFoundError";
  }
}

export class SupportGrantNotFoundError extends Error {
  readonly statusCode = 404;
  constructor() {
    super("Support Access Grant was not found");
    this.name = "SupportGrantNotFoundError";
  }
}

export class WorkspaceNotFoundError extends Error {
  readonly statusCode = 404;
  constructor() {
    super("Workspace was not found");
    this.name = "WorkspaceNotFoundError";
  }
}

export class NotWorkspaceOwnerError extends Error {
  readonly statusCode = 403;
  constructor() {
    super("Only the Owner can require a second factor");
    this.name = "NotWorkspaceOwnerError";
  }
}

export class OwnerSecondFactorMissingError extends Error {
  readonly statusCode = 409;
  constructor() {
    super("Set up a second factor on your own account before requiring one for the Workspace");
    this.name = "OwnerSecondFactorMissingError";
  }
}

export type PlatformStaffRecord = {
  id: string;
  email: string | null;
  linkedUserId: string | null;
};

export async function findPlatformStaffBySubject(subjectId: string): Promise<PlatformStaffRecord | undefined> {
  const [row] = await db
    .select({
      id: platformStaff.id,
      email: platformStaff.email,
      linkedUserId: platformStaff.linkedUserId,
    })
    .from(platformStaff)
    .where(eq(platformStaff.subjectId, subjectId))
    .limit(1);
  return row;
}

export async function listPlatformStaff(): Promise<Array<{ id: string; email: string | null }>> {
  return db
    .select({ id: platformStaff.id, email: platformStaff.email })
    .from(platformStaff)
    .orderBy(platformStaff.email);
}

type GrantRow = {
  id: string;
  platformStaffId: string;
  expiresAt: Date;
  revokedAt: Date | null;
};

function isActive(grant: GrantRow, now: Date): boolean {
  return grant.revokedAt == null && grant.expiresAt.getTime() > now.getTime();
}

async function workspaceName(workspaceId: string): Promise<string> {
  const [row] = await db
    .select({ name: workspaces.name })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  if (!row) throw new WorkspaceNotFoundError();
  return row.name;
}

async function grantsFor(staffId: string): Promise<GrantRow[]> {
  return db
    .select({
      id: supportAccessGrants.id,
      platformStaffId: supportAccessGrants.platformStaffId,
      expiresAt: supportAccessGrants.expiresAt,
      revokedAt: supportAccessGrants.revokedAt,
    })
    .from(supportAccessGrants)
    .where(eq(supportAccessGrants.platformStaffId, staffId));
}

async function recordExpiry(grants: GrantRow[], now: Date): Promise<void> {
  const expired = grants.filter((grant) => grant.revokedAt == null && grant.expiresAt.getTime() <= now.getTime());
  if (expired.length === 0) return;
  const ids = expired.map((grant) => grant.id);
  const already = await db
    .select({ resourceId: auditEvents.resourceId })
    .from(auditEvents)
    .where(and(eq(auditEvents.action, "support_access.expired"), inArray(auditEvents.resourceId, ids)));
  const seen = new Set(already.map((row) => row.resourceId));
  const fresh = expired.filter((grant) => !seen.has(grant.id));
  if (fresh.length === 0) return;
  await db.insert(auditEvents).values(
    fresh.map((grant) =>
      stampWorkspace({
        actorKind: "system" as const,
        actorId: null,
        action: "support_access.expired",
        resourceType: "support_access_grants",
        resourceId: grant.id,
        payload: { platformStaffId: grant.platformStaffId },
      }),
    ),
  );
}

async function notifyOwners(type: string, message: string): Promise<void> {
  const rows = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .innerJoin(workspaceRoles, eq(workspaceRoles.id, memberships.workspaceRoleId))
    .where(and(inWorkspace(memberships), isNull(memberships.archivedAt), eq(workspaceRoles.slug, "owner")));
  if (rows.length === 0) return;
  await db.insert(notifications).values(
    rows.map((row) => ({
      ...stampWorkspace({ type }),
      userId: row.userId,
      message,
    })),
  );
}

export type OperatorRead = {
  id: string;
  name: string;
  access: "grant" | "break_glass";
};

/** Workspace content for Platform Staff. A grant or break-glass, and nothing else. */
export async function readOperatorWorkspace(
  staffId: string,
  workspaceId: string,
  now = new Date(),
): Promise<OperatorRead> {
  return runWithWorkspaceContext({ workspaceId }, async () => {
    const name = await workspaceName(workspaceId);
    const grants = await grantsFor(staffId);
    const active = grants.find((grant) => isActive(grant, now));
    if (active) {
      await db.insert(auditEvents).values(
        stampWorkspace({
          actorKind: "platform_staff" as const,
          actorId: staffId,
          action: "support_access.used",
          resourceType: "support_access_grants",
          resourceId: active.id,
          payload: { via: "grant" },
        }),
      );
      return { id: workspaceId, name, access: "grant" as const };
    }

    const [glass] = await db
      .select({ id: breakGlassAccess.id })
      .from(breakGlassAccess)
      .where(eq(breakGlassAccess.platformStaffId, staffId))
      .limit(1);
    if (glass) {
      await db.insert(auditEvents).values(
        stampWorkspace({
          actorKind: "platform_staff" as const,
          actorId: staffId,
          action: "support_access.used",
          resourceType: "break_glass_access",
          resourceId: glass.id,
          payload: { via: "break_glass" },
        }),
      );
      return { id: workspaceId, name, access: "break_glass" as const };
    }

    await recordExpiry(grants, now);
    throw new OperatorAccessDeniedError();
  });
}

/** No operator write is a grant or a break-glass. A write is its own audited command. */
export async function refuseOperatorWrite(staffId: string, workspaceId: string, now = new Date()): Promise<never> {
  await runWithWorkspaceContext({ workspaceId }, async () => {
    await workspaceName(workspaceId);
    const grants = await grantsFor(staffId);
    if (grants.some((grant) => isActive(grant, now))) throw new SupportAccessReadOnlyError();
    const [glass] = await db
      .select({ id: breakGlassAccess.id })
      .from(breakGlassAccess)
      .where(eq(breakGlassAccess.platformStaffId, staffId))
      .limit(1);
    if (glass) throw new SupportAccessReadOnlyError();
  });
  throw new OperatorAccessDeniedError();
}

export async function openBreakGlass(
  staffId: string,
  workspaceId: string,
  reason: string,
): Promise<{ id: string; workspaceId: string }> {
  const written = reason.trim();
  if (!written) throw new BreakGlassReasonError();
  return runWithWorkspaceContext({ workspaceId }, async () => {
    await workspaceName(workspaceId);
    const [row] = await db
      .insert(breakGlassAccess)
      .values(stampWorkspace({ platformStaffId: staffId, reason: written }))
      .returning({ id: breakGlassAccess.id });
    await db.insert(auditEvents).values(
      stampWorkspace({
        actorKind: "platform_staff" as const,
        actorId: staffId,
        action: "support_access.break_glass",
        resourceType: "break_glass_access",
        resourceId: row.id,
        payload: { reason: written },
      }),
    );
    await notifyOwners(
      "break_glass",
      "Platform Staff opened break-glass access to this Workspace. The reason is recorded on the Audit Event.",
    );
    return { id: row.id, workspaceId };
  });
}

export type SupportGrantView = {
  id: string;
  platformStaffId: string;
  email: string | null;
  expiresAt: Date;
  createdAt: Date;
};

export async function listActiveSupportGrants(now = new Date()): Promise<SupportGrantView[]> {
  const rows = await db
    .select({
      id: supportAccessGrants.id,
      platformStaffId: supportAccessGrants.platformStaffId,
      email: platformStaff.email,
      expiresAt: supportAccessGrants.expiresAt,
      revokedAt: supportAccessGrants.revokedAt,
      createdAt: supportAccessGrants.createdAt,
    })
    .from(supportAccessGrants)
    .innerJoin(platformStaff, eq(platformStaff.id, supportAccessGrants.platformStaffId));
  return rows
    .filter((row) => row.revokedAt == null && row.expiresAt.getTime() > now.getTime())
    .map(({ revokedAt: _revoked, ...grant }) => grant);
}

export async function createSupportGrant(input: {
  platformStaffId: string;
  createdByUserId: string;
  hours?: number;
  now?: Date;
}): Promise<SupportGrantView> {
  const now = input.now ?? new Date();
  const expiresAt = grantExpiresAt(now, input.hours);
  const [staff] = await db
    .select({ id: platformStaff.id, email: platformStaff.email })
    .from(platformStaff)
    .where(eq(platformStaff.id, input.platformStaffId))
    .limit(1);
  if (!staff) throw new PlatformStaffNotFoundError();

  const [row] = await db
    .insert(supportAccessGrants)
    .values(
      stampWorkspace({
        platformStaffId: staff.id,
        createdByUserId: input.createdByUserId,
        expiresAt,
      }),
    )
    .returning({ id: supportAccessGrants.id, createdAt: supportAccessGrants.createdAt });

  await db.insert(auditEvents).values(
    stampWorkspace({
      actorKind: "user" as const,
      actorId: input.createdByUserId,
      action: "support_access.granted",
      resourceType: "support_access_grants",
      resourceId: row.id,
      payload: { platformStaffId: staff.id, expiresAt: expiresAt.toISOString() },
    }),
  );
  await notifyOwners(
    "support_access_granted",
    "Platform Staff were granted read-only access to this Workspace. It expires on its own, and you can revoke it.",
  );

  return {
    id: row.id,
    platformStaffId: staff.id,
    email: staff.email,
    expiresAt,
    createdAt: row.createdAt,
  };
}

export async function revokeSupportGrant(grantId: string, revokedByUserId: string, now = new Date()): Promise<void> {
  const [grant] = await db
    .select({
      id: supportAccessGrants.id,
      revokedAt: supportAccessGrants.revokedAt,
      expiresAt: supportAccessGrants.expiresAt,
    })
    .from(supportAccessGrants)
    .where(eq(supportAccessGrants.id, grantId))
    .limit(1);
  if (!grant || grant.revokedAt != null || grant.expiresAt.getTime() <= now.getTime()) {
    throw new SupportGrantNotFoundError();
  }
  await db
    .update(supportAccessGrants)
    .set({ revokedAt: now, revokedByUserId })
    .where(eq(supportAccessGrants.id, grantId));
  await db.insert(auditEvents).values(
    stampWorkspace({
      actorKind: "user" as const,
      actorId: revokedByUserId,
      action: "support_access.revoked",
      resourceType: "support_access_grants",
      resourceId: grantId,
      payload: {},
    }),
  );
}

export async function workspaceRequiresTwoFactor(): Promise<boolean> {
  const [row] = await db
    .select({ requireTwoFactor: orgSettings.requireTwoFactor })
    .from(orgSettings)
    .where(and(inWorkspace(orgSettings), eq(orgSettings.id, "default")))
    .limit(1);
  return row?.requireTwoFactor === true;
}

export async function setWorkspaceTwoFactor(
  required: boolean,
  actorId: string,
  actorHasSecondFactor: boolean,
): Promise<{ required: boolean }> {
  if ((await currentWorkspaceRoleSlug()) !== "owner") throw new NotWorkspaceOwnerError();
  // Once the requirement is on, this toggle itself needs a verified factor:
  // an Owner without one would lock themselves out.
  if (required && !actorHasSecondFactor) throw new OwnerSecondFactorMissingError();
  await db
    .insert(orgSettings)
    .values(stampWorkspace({ id: "default", requireTwoFactor: required, updatedAt: new Date() }))
    .onConflictDoUpdate({
      target: [orgSettings.workspaceId, orgSettings.id],
      set: { requireTwoFactor: required, updatedAt: new Date() },
    });
  await db.insert(auditEvents).values(
    stampWorkspace({
      actorKind: "user" as const,
      actorId,
      action: "workspace.two_factor_required",
      resourceType: "org_settings",
      resourceId: "default",
      payload: { required },
    }),
  );
  return { required };
}

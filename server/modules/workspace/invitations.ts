/**
 * Workspace Invitation (#211, Flow 6).
 *
 * Send and revoke are Owner / Administrator writes. Acceptance creates a
 * Membership in the invited Workspace and never a Workspace. A pending
 * Invitation consumes no Billable Seat; `assertSeatAvailable` runs at send.
 */

import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  invitations,
  memberships,
  users,
  workspaceRoles,
  workspaces,
} from "@shared/schema";
import { config } from "../../config";
import { db } from "../../db";
import { inWorkspace, requireWorkspaceContext, runWithWorkspaceContext, stampWorkspace } from "../../workspaceContext";
import { assertSeatAvailable } from "../billing/seats";
import { sendInvitationEmail } from "../../email";
import { identityProvider } from "../identity";
import { bearerToken } from "../identity/webSession";
import { membershipRoleLabel } from "./activeWorkspace";
import { canManageAdministration } from "../../workspaceRole";

const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const INVITE_ROLES = new Set(["MEMBER", "ADMINISTRATOR"]);

export type InvitationView = {
  id: string;
  email: string;
  workspaceRole: string;
  status: string;
  consumesSeat: false;
  expiresAt: Date;
};

export class InvitationNotFoundError extends Error {
  readonly statusCode = 404;
  constructor() {
    super("Invitation not found");
    this.name = "InvitationNotFoundError";
  }
}

export class InvitationRoleError extends Error {
  readonly statusCode = 400;
  constructor() {
    super("Invitation Workspace Role must be MEMBER or ADMINISTRATOR");
    this.name = "InvitationRoleError";
  }
}

export class InvitationDuplicateMembershipError extends Error {
  readonly statusCode = 409;
  constructor() {
    super("This email already holds a Membership in this Workspace");
    this.name = "InvitationDuplicateMembershipError";
  }
}

export class InvitationAlreadyPendingError extends Error {
  readonly statusCode = 409;
  constructor() {
    super("An Invitation is already pending for this email");
    this.name = "InvitationAlreadyPendingError";
  }
}

export class InvitationRevokedError extends Error {
  readonly statusCode = 409;
  constructor() {
    super("This Invitation was revoked");
    this.name = "InvitationRevokedError";
  }
}

export class InvitationExpiredError extends Error {
  readonly statusCode = 409;
  constructor() {
    super("This Invitation expired");
    this.name = "InvitationExpiredError";
  }
}

export class InvitationAlreadyAcceptedError extends Error {
  readonly statusCode = 409;
  constructor() {
    super("This Invitation was already accepted");
    this.name = "InvitationAlreadyAcceptedError";
  }
}

export class InvitationEmailMismatchError extends Error {
  readonly statusCode = 403;
  constructor() {
    super("This Invitation was sent to a different email");
    this.name = "InvitationEmailMismatchError";
  }
}

export class InvitationUnauthorizedError extends Error {
  readonly statusCode = 401;
  constructor() {
    super("Unauthorized");
    this.name = "InvitationUnauthorizedError";
  }
}

export class MembershipNotFoundError extends Error {
  readonly statusCode = 404;
  constructor() {
    super("Membership not found");
    this.name = "MembershipNotFoundError";
  }
}

export async function canManageInvitations(): Promise<boolean> {
  return canManageAdministration();
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function mintToken(): string {
  return randomBytes(32).toString("hex");
}

function toView(row: {
  id: string;
  email: string;
  status: string;
  expiresAt: Date;
  slug: string;
}): InvitationView {
  return {
    id: row.id,
    email: row.email,
    workspaceRole: membershipRoleLabel(row.slug),
    status: row.status,
    consumesSeat: false,
    expiresAt: row.expiresAt,
  };
}

async function roleIdForLabel(label: string): Promise<string> {
  const slug = label === "ADMINISTRATOR" ? "administrator" : "member";
  const [role] = await db
    .select({ id: workspaceRoles.id })
    .from(workspaceRoles)
    .where(and(inWorkspace(workspaceRoles), eq(workspaceRoles.slug, slug)))
    .limit(1);
  if (!role) throw new InvitationRoleError();
  return role.id;
}

export async function listWorkspaceInvitations(): Promise<InvitationView[]> {
  const rows = await db
    .select({
      id: invitations.id,
      email: invitations.email,
      status: invitations.status,
      expiresAt: invitations.expiresAt,
      slug: workspaceRoles.slug,
    })
    .from(invitations)
    .innerJoin(workspaceRoles, eq(workspaceRoles.id, invitations.workspaceRoleId))
    .where(and(inWorkspace(invitations), eq(invitations.status, "pending")));
  const now = Date.now();
  return rows.filter((row) => row.expiresAt.getTime() > now).map(toView);
}

export type PendingInvitationView = {
  id: string;
  workspaceId: string;
  workspaceName: string;
  workspaceRole: string;
  token: string;
};

export async function listInvitationsForUser(userId: string): Promise<PendingInvitationView[]> {
  const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return [];
  return listInvitationsForEmail(user.email);
}

export async function listInvitationsForEmail(email: string): Promise<PendingInvitationView[]> {
  const rows = await db
    .select({
      id: invitations.id,
      workspaceId: invitations.workspaceId,
      workspaceName: workspaces.name,
      slug: workspaceRoles.slug,
      expiresAt: invitations.expiresAt,
      token: invitations.token,
    })
    .from(invitations)
    .innerJoin(workspaces, eq(workspaces.id, invitations.workspaceId))
    .innerJoin(workspaceRoles, eq(workspaceRoles.id, invitations.workspaceRoleId))
    .where(and(eq(invitations.email, email), eq(invitations.status, "pending")));
  const now = Date.now();
  return rows
    .filter((row) => row.expiresAt.getTime() > now)
    .map((row) => ({
      id: row.id,
      workspaceId: row.workspaceId,
      workspaceName: row.workspaceName,
      workspaceRole: membershipRoleLabel(row.slug),
      token: row.token,
    }));
}

export async function sendInvitation(
  actorUserId: string,
  input: { email: string; workspaceRole: string },
): Promise<InvitationView> {
  const roleLabel = input.workspaceRole.trim().toUpperCase();
  if (!INVITE_ROLES.has(roleLabel)) throw new InvitationRoleError();
  const email = normalizeEmail(input.email);

  await assertSeatAvailable();
  const workspaceRoleId = await roleIdForLabel(roleLabel);
  const { workspaceId } = requireWorkspaceContext();

  const [member] = await db
    .select({ id: memberships.id, archivedAt: memberships.archivedAt })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(inWorkspace(memberships), eq(users.email, email)))
    .limit(1);
  if (member && member.archivedAt == null) throw new InvitationDuplicateMembershipError();

  const [existing] = await db
    .select()
    .from(invitations)
    .where(and(inWorkspace(invitations), eq(invitations.email, email)))
    .limit(1);
  if (existing?.status === "pending" && existing.expiresAt.getTime() > Date.now()) {
    throw new InvitationAlreadyPendingError();
  }

  const token = mintToken();
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  const values = stampWorkspace({
    email,
    workspaceRoleId,
    token,
    status: "pending" as const,
    invitedByUserId: actorUserId,
    expiresAt,
    acceptedAt: null,
    revokedAt: null,
    updatedAt: new Date(),
  });

  const row = existing
    ? (
        await db
          .update(invitations)
          .set(values)
          .where(eq(invitations.id, existing.id))
          .returning()
      )[0]
    : (await db.insert(invitations).values(values).returning())[0];

  const [workspace] = await db
    .select({ name: workspaces.name })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);

  await sendInvitationEmail({
    toEmail: email,
    workspaceName: workspace?.name ?? "Workspace",
    workspaceRole: roleLabel,
    acceptUrl: `${config.appUrl}/invitations/${token}`,
  });

  return toView({
    id: row.id,
    email: row.email,
    status: row.status,
    expiresAt: row.expiresAt,
    slug: roleLabel === "ADMINISTRATOR" ? "administrator" : "member",
  });
}

export async function revokeInvitation(id: string): Promise<InvitationView> {
  const [row] = await db
    .select({
      id: invitations.id,
      email: invitations.email,
      status: invitations.status,
      expiresAt: invitations.expiresAt,
      slug: workspaceRoles.slug,
    })
    .from(invitations)
    .innerJoin(workspaceRoles, eq(workspaceRoles.id, invitations.workspaceRoleId))
    .where(and(inWorkspace(invitations), eq(invitations.id, id)))
    .limit(1);
  if (!row) throw new InvitationNotFoundError();
  if (row.status === "revoked") return { ...toView(row), status: "revoked" };
  if (row.status !== "pending") throw new InvitationNotFoundError();

  const [updated] = await db
    .update(invitations)
    .set({ status: "revoked", revokedAt: new Date(), updatedAt: new Date() })
    .where(and(inWorkspace(invitations), eq(invitations.id, id)))
    .returning({
      id: invitations.id,
      email: invitations.email,
      status: invitations.status,
      expiresAt: invitations.expiresAt,
    });
  return { ...toView({ ...row, status: updated.status }), status: "revoked" };
}

export type AcceptedInvitation = {
  workspaceId: string;
  workspaceRole: string;
  membershipId: string;
};

export async function acceptInvitation(input: {
  token: string;
  authorization: string | undefined;
}): Promise<AcceptedInvitation> {
  const sessionToken = bearerToken(input.authorization);
  if (!sessionToken) throw new InvitationUnauthorizedError();
  let providerSubjectId: string;
  try {
    ({ providerSubjectId } = await identityProvider.verifySessionToken(sessionToken));
  } catch {
    throw new InvitationUnauthorizedError();
  }

  const [invitation] = await db
    .select({
      id: invitations.id,
      email: invitations.email,
      status: invitations.status,
      expiresAt: invitations.expiresAt,
      workspaceId: invitations.workspaceId,
      workspaceRoleId: invitations.workspaceRoleId,
      slug: workspaceRoles.slug,
    })
    .from(invitations)
    .innerJoin(workspaceRoles, eq(workspaceRoles.id, invitations.workspaceRoleId))
    .where(eq(invitations.token, input.token))
    .limit(1);
  if (!invitation) throw new InvitationNotFoundError();
  if (invitation.status === "revoked") throw new InvitationRevokedError();
  if (invitation.status === "accepted") throw new InvitationAlreadyAcceptedError();
  if (invitation.status === "expired" || invitation.expiresAt.getTime() <= Date.now()) {
    throw new InvitationExpiredError();
  }

  return runWithWorkspaceContext({ workspaceId: invitation.workspaceId }, async () => {
    const user = await resolveInvitee(providerSubjectId, invitation.email);
    const membershipId = await createOrRestoreMembership(user.id, invitation.workspaceRoleId);
    await db
      .update(users)
      .set({ activeWorkspaceId: invitation.workspaceId, updatedAt: new Date() })
      .where(eq(users.id, user.id));
    await db
      .update(invitations)
      .set({ status: "accepted", acceptedAt: new Date(), updatedAt: new Date() })
      .where(eq(invitations.id, invitation.id));
    return {
      workspaceId: invitation.workspaceId,
      workspaceRole: membershipRoleLabel(invitation.slug),
      membershipId,
    };
  });
}

async function resolveInvitee(
  providerSubjectId: string,
  email: string,
): Promise<{ id: string; email: string }> {
  const [bySubject] = await db
    .select({ id: users.id, email: users.email, identityProviderSubjectId: users.identityProviderSubjectId })
    .from(users)
    .where(eq(users.identityProviderSubjectId, providerSubjectId))
    .limit(1);
  if (bySubject) {
    if (bySubject.email !== email) throw new InvitationEmailMismatchError();
    return bySubject;
  }

  const [byEmail] = await db
    .select({ id: users.id, email: users.email, identityProviderSubjectId: users.identityProviderSubjectId })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (byEmail) {
    if (byEmail.identityProviderSubjectId && byEmail.identityProviderSubjectId !== providerSubjectId) {
      throw new InvitationEmailMismatchError();
    }
    if (!byEmail.identityProviderSubjectId) {
      await db
        .update(users)
        .set({ identityProviderSubjectId: providerSubjectId, updatedAt: new Date() })
        .where(eq(users.id, byEmail.id));
    }
    return byEmail;
  }

  const [created] = await db
    .insert(users)
    .values({
      email,
      identityProviderSubjectId: providerSubjectId,
    })
    .returning({ id: users.id, email: users.email });
  return created;
}

async function createOrRestoreMembership(userId: string, workspaceRoleId: string): Promise<string> {
  const { workspaceId } = requireWorkspaceContext();
  const [existing] = await db
    .select({ id: memberships.id, archivedAt: memberships.archivedAt })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.workspaceId, workspaceId)))
    .limit(1);
  if (existing && existing.archivedAt == null) throw new InvitationDuplicateMembershipError();
  if (existing) {
    await db
      .update(memberships)
      .set({ archivedAt: null, workspaceRoleId, updatedAt: new Date() })
      .where(eq(memberships.id, existing.id));
    return existing.id;
  }
  const [created] = await db
    .insert(memberships)
    .values({
      workspaceId,
      userId,
      workspaceRoleId,
    })
    .returning({ id: memberships.id });
  return created.id;
}

export type MembershipProfileView = {
  membershipId: string;
  userId: string;
  hoursPerDay: number;
  canViewDailyUpdates: number;
};

export async function updateMembershipProfile(
  membershipId: string,
  patch: { hoursPerDay?: number; canViewDailyUpdates?: number },
): Promise<MembershipProfileView> {
  const [row] = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(inWorkspace(memberships), eq(memberships.id, membershipId)))
    .limit(1);
  if (!row) throw new MembershipNotFoundError();
  const [updated] = await db
    .update(users)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(users.id, row.userId))
    .returning({
      hoursPerDay: users.hoursPerDay,
      canViewDailyUpdates: users.canViewDailyUpdates,
    });
  return {
    membershipId,
    userId: row.userId,
    hoursPerDay: updated.hoursPerDay,
    canViewDailyUpdates: updated.canViewDailyUpdates,
  };
}

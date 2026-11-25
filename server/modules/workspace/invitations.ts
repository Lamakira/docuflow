/**
 * Workspace Invitation (#211, Flow 6).
 *
 * Send, resend and revoke are Owner / Administrator writes. Acceptance creates a
 * Membership in the invited Workspace and never a Workspace. A pending
 * Invitation consumes no Billable Seat: the seat is checked when it is sent, and
 * taken when it is accepted.
 */

import { randomBytes } from "node:crypto";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import {
  invitations,
  memberships,
  users,
  workspaceRoles,
  workspaces,
} from "@shared/schema";
import { config } from "../../config";
import { db } from "../../db";
import {
  forWorkspaces,
  inWorkspace,
  requireWorkspaceContext,
  runWithWorkspaceContext,
  stampWorkspace,
} from "../../workspaceContext";
import { invitationForToken, invitationsForEmail } from "../../workspaceLocators";
import { assertSeatAvailable, lockSeats } from "../billing/seats";
import { sendInvitationEmail } from "../../email";
import { identityProvider } from "../identity";
import { IdentityProviderError } from "../identity/identityProvider";
import { bearerToken } from "../identity/webSession";
import { membershipRoleLabel } from "./activeWorkspace";
import {
  AccountArchivedError,
  isLookupKey,
  recordMembershipEvent,
  type Tx,
} from "./membershipManagement";

const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const RESEND_WAIT_MS = 60 * 1000;
const UNIQUE_VIOLATION = "23505";
const INVITE_ROLES = new Set(["MEMBER", "ADMINISTRATOR"]);

export type InvitationView = {
  id: string;
  email: string;
  workspaceRole: string;
  status: string;
  expiresAt: Date;
  invitedBy: string | null;
  consumesSeat: false;
};

export type SentInvitationView = InvitationView & { emailSent: boolean };

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

export class InvitationUnverifiedEmailError extends Error {
  readonly statusCode = 403;
  constructor() {
    super("Confirm your email address with your sign-in provider, then reload this page");
    this.name = "InvitationUnverifiedEmailError";
  }
}

export class InvitationJustSentError extends Error {
  readonly statusCode = 429;
  constructor() {
    super("This Invitation was just sent. Try again in a minute.");
    this.name = "InvitationJustSentError";
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function mintToken(): string {
  return randomBytes(32).toString("hex");
}

type InvitationRow = {
  id: string;
  email: string;
  status: string;
  expiresAt: Date;
  slug: string;
  inviterFirstName: string | null;
  inviterLastName: string | null;
};

const invitationColumns = {
  id: invitations.id,
  email: invitations.email,
  status: invitations.status,
  expiresAt: invitations.expiresAt,
  slug: workspaceRoles.slug,
  inviterFirstName: users.firstName,
  inviterLastName: users.lastName,
};

/** The inviter's name, never their address: the sessionless lookup shows it too. */
function inviterName(row: { inviterFirstName: string | null; inviterLastName: string | null }): string | null {
  return [row.inviterFirstName, row.inviterLastName].filter(Boolean).join(" ").trim() || null;
}

function standingOf(row: { status: string; expiresAt: Date }): string {
  return row.status === "pending" && row.expiresAt.getTime() <= Date.now() ? "expired" : row.status;
}

function toView(row: InvitationRow): InvitationView {
  return {
    id: row.id,
    email: row.email,
    workspaceRole: membershipRoleLabel(row.slug),
    status: standingOf(row),
    expiresAt: row.expiresAt,
    invitedBy: inviterName(row),
    consumesSeat: false,
  };
}

async function invitationRow(reader: Pick<typeof db, "select">, id: string): Promise<InvitationRow> {
  const [row] = await reader
    .select(invitationColumns)
    .from(invitations)
    .innerJoin(workspaceRoles, eq(workspaceRoles.id, invitations.workspaceRoleId))
    .innerJoin(users, eq(users.id, invitations.invitedByUserId))
    .where(and(inWorkspace(invitations), eq(invitations.id, id)))
    .limit(1);
  if (!row) throw new InvitationNotFoundError();
  return row;
}

async function lockInvitation(tx: Tx, id: string) {
  const [row] = await tx
    .select()
    .from(invitations)
    .where(and(inWorkspace(invitations), eq(invitations.id, id)))
    .for("update");
  if (!row) throw new InvitationNotFoundError();
  return row;
}

async function roleIdForLabel(reader: Pick<typeof db, "select">, label: string): Promise<string> {
  const slug = label === "ADMINISTRATOR" ? "administrator" : "member";
  const [role] = await reader
    .select({ id: workspaceRoles.id })
    .from(workspaceRoles)
    .where(and(inWorkspace(workspaceRoles), eq(workspaceRoles.slug, slug)))
    .limit(1);
  if (!role) throw new InvitationRoleError();
  return role.id;
}

/** The Invitations not settled yet. One past its date is listed as expired, to be sent again or revoked. */
export async function listWorkspaceInvitations(): Promise<InvitationView[]> {
  const rows = await db
    .select(invitationColumns)
    .from(invitations)
    .innerJoin(workspaceRoles, eq(workspaceRoles.id, invitations.workspaceRoleId))
    .innerJoin(users, eq(users.id, invitations.invitedByUserId))
    .where(and(inWorkspace(invitations), eq(invitations.status, "pending")))
    .orderBy(asc(invitations.createdAt), asc(invitations.id));
  return rows.map(toView);
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
  const now = Date.now();
  const pending = (await invitationsForEmail(normalizeEmail(email))).filter(
    (row) => row.status === "pending" && row.expiresAt.getTime() > now,
  );
  // Details are read inside each invitation's Workspace: RLS hides the others (#323).
  const views = await forWorkspaces(
    pending.map((row) => ({ id: row.workspaceId, invitationId: row.id })),
    async (ref): Promise<PendingInvitationView | null> => {
      const [row] = await db
        .select({
          id: invitations.id,
          workspaceId: invitations.workspaceId,
          workspaceName: workspaces.name,
          slug: workspaceRoles.slug,
          token: invitations.token,
        })
        .from(invitations)
        .innerJoin(workspaces, eq(workspaces.id, invitations.workspaceId))
        .innerJoin(workspaceRoles, eq(workspaceRoles.id, invitations.workspaceRoleId))
        .where(eq(invitations.id, ref.invitationId))
        .limit(1);
      if (!row) return null;
      return {
        id: row.id,
        workspaceId: row.workspaceId,
        workspaceName: row.workspaceName,
        workspaceRole: membershipRoleLabel(row.slug),
        token: row.token,
      };
    },
  );
  return views.filter((view): view is PendingInvitationView => view !== null);
}

export async function sendInvitation(
  actorUserId: string,
  input: { email: string; workspaceRole: string },
): Promise<SentInvitationView> {
  const roleLabel = input.workspaceRole.trim().toUpperCase();
  if (!INVITE_ROLES.has(roleLabel)) throw new InvitationRoleError();
  const email = normalizeEmail(input.email);
  const token = mintToken();

  const row = await db.transaction(async (tx) => {
    // Locks the Workspace's seats, so a second send for the address waits here
    // and then finds the first.
    await assertSeatAvailable(tx);
    const workspaceRoleId = await roleIdForLabel(tx, roleLabel);

    const [member] = await tx
      .select({ id: memberships.id })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(
        and(inWorkspace(memberships), isNull(memberships.archivedAt), sql`lower(${users.email}) = ${email}`),
      )
      .limit(1);
    if (member) throw new InvitationDuplicateMembershipError();

    const [existing] = await tx
      .select()
      .from(invitations)
      .where(and(inWorkspace(invitations), sql`lower(${invitations.email}) = ${email}`))
      .limit(1)
      .for("update");
    if (existing && standingOf(existing) === "pending") throw new InvitationAlreadyPendingError();

    const values = stampWorkspace({
      email,
      workspaceRoleId,
      token,
      status: "pending" as const,
      invitedByUserId: actorUserId,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      acceptedAt: null,
      revokedAt: null,
      updatedAt: new Date(),
    });
    const [written] = existing
      ? await tx
          .update(invitations)
          .set(values)
          .where(eq(invitations.id, existing.id))
          .returning({ id: invitations.id })
      : await tx.insert(invitations).values(values).onConflictDoNothing().returning({ id: invitations.id });
    if (!written) throw new InvitationAlreadyPendingError();
    await recordMembershipEvent(tx, actorUserId, {
      action: "invitation.sent",
      resourceType: "invitations",
      resourceId: written.id,
      payload: { workspaceRole: roleLabel },
    });
    return invitationRow(tx, written.id);
  });

  return { ...toView(row), emailSent: await emailInvitation(row, token) };
}

/**
 * Send a pending or expired Invitation again. The new token replaces the old
 * one, so the earlier link stops working.
 */
export async function resendInvitation(actorUserId: string, id: string): Promise<SentInvitationView> {
  if (!isLookupKey(id)) throw new InvitationNotFoundError();
  const token = mintToken();

  const row = await db.transaction(async (tx) => {
    await lockSeats(tx);
    const invitation = await lockInvitation(tx, id);
    if (invitation.status !== "pending") throw new InvitationNotFoundError();
    if (Date.now() - (invitation.updatedAt?.getTime() ?? 0) < RESEND_WAIT_MS) {
      throw new InvitationJustSentError();
    }
    await assertSeatAvailable(tx);
    await tx
      .update(invitations)
      .set({ token, expiresAt: new Date(Date.now() + INVITE_TTL_MS), updatedAt: new Date() })
      .where(eq(invitations.id, id));
    await recordMembershipEvent(tx, actorUserId, {
      action: "invitation.resent",
      resourceType: "invitations",
      resourceId: id,
      payload: {},
    });
    return invitationRow(tx, id);
  });

  return { ...toView(row), emailSent: await emailInvitation(row, token) };
}

/** Whether the email left. One that did not is no send: it may be tried again at once. */
async function emailInvitation(row: InvitationRow, token: string): Promise<boolean> {
  const { workspaceId } = requireWorkspaceContext();
  const [workspace] = await db
    .select({ name: workspaces.name })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  const { success } = await sendInvitationEmail({
    toEmail: row.email,
    workspaceName: workspace?.name ?? "Workspace",
    workspaceRole: membershipRoleLabel(row.slug),
    inviterName: inviterName(row),
    expiresAt: row.expiresAt,
    acceptUrl: `${config.appUrl}/invitations/${token}`,
  });
  if (!success) {
    await db
      .update(invitations)
      .set({ updatedAt: new Date(Date.now() - RESEND_WAIT_MS) })
      .where(and(inWorkspace(invitations), eq(invitations.token, token)));
  }
  return success;
}

export async function revokeInvitation(actorUserId: string, id: string): Promise<InvitationView> {
  if (!isLookupKey(id)) throw new InvitationNotFoundError();
  return db.transaction(async (tx) => {
    const { status } = await lockInvitation(tx, id);
    if (status !== "revoked") {
      if (status !== "pending") throw new InvitationNotFoundError();
      await tx
        .update(invitations)
        .set({ status: "revoked", revokedAt: new Date(), updatedAt: new Date() })
        .where(eq(invitations.id, id));
      await recordMembershipEvent(tx, actorUserId, {
        action: "invitation.revoked",
        resourceType: "invitations",
        resourceId: id,
        payload: {},
      });
    }
    return toView(await invitationRow(tx, id));
  });
}

export type InvitationLookup = {
  workspaceName: string;
  workspaceRole: string;
  invitedBy: string | null;
  email: string;
  status: string;
  expiresAt: Date;
};

/** What the holder of a link may read before signing in (F90). No id, no token. */
export async function lookupInvitation(token: string): Promise<InvitationLookup> {
  const located = isLookupKey(token) ? await invitationForToken(token) : undefined;
  if (!located) throw new InvitationNotFoundError();
  return runWithWorkspaceContext({ workspaceId: located.workspaceId }, async () => {
    const [row] = await db
      .select({ ...invitationColumns, workspaceName: workspaces.name })
      .from(invitations)
      .innerJoin(workspaces, eq(workspaces.id, invitations.workspaceId))
      .innerJoin(workspaceRoles, eq(workspaceRoles.id, invitations.workspaceRoleId))
      .innerJoin(users, eq(users.id, invitations.invitedByUserId))
      .where(and(inWorkspace(invitations), eq(invitations.token, token)))
      .limit(1);
    if (!row) throw new InvitationNotFoundError();
    const { workspaceRole, invitedBy, email, status, expiresAt } = toView(row);
    return { workspaceName: row.workspaceName, workspaceRole, invitedBy, email, status, expiresAt };
  });
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

  const located = isLookupKey(input.token) ? await invitationForToken(input.token) : undefined;
  if (!located) throw new InvitationNotFoundError();

  return runWithWorkspaceContext({ workspaceId: located.workspaceId }, async () => {
    // Asked before the transaction: no lock waits on the provider.
    const verifiedEmail = await verifiedEmailOf(providerSubjectId, located.id, input.token);

    const accept = () => db.transaction(async (tx): Promise<AcceptedInvitation> => {
      // Seats, the Invitation, the account, the Membership: every seat decision
      // locks them in this order.
      await lockSeats(tx);
      const invitation = await lockInvitation(tx, located.id);
      assertOpen(invitation, input.token);

      const user = await resolveInvitee(tx, providerSubjectId, invitation.email, verifiedEmail);
      if (user.isArchived) throw new AccountArchivedError();
      const membershipId = await createOrRestoreMembership(tx, user.id, invitation.workspaceRoleId);
      await tx
        .update(users)
        .set({ activeWorkspaceId: invitation.workspaceId, updatedAt: new Date() })
        .where(eq(users.id, user.id));
      await tx
        .update(invitations)
        .set({ status: "accepted", acceptedAt: new Date(), updatedAt: new Date() })
        .where(eq(invitations.id, invitation.id));
      const [role] = await tx
        .select({ slug: workspaceRoles.slug })
        .from(workspaceRoles)
        .where(and(inWorkspace(workspaceRoles), eq(workspaceRoles.id, invitation.workspaceRoleId)))
        .limit(1);
      return {
        workspaceId: invitation.workspaceId,
        workspaceRole: membershipRoleLabel(role?.slug ?? "member"),
        membershipId,
      };
    });
    try {
      return await accept();
    } catch (error) {
      // Registration linked this subject to another row meanwhile: that row answers.
      if ((error as { code?: string })?.code === UNIQUE_VIOLATION) return accept();
      throw error;
    }
  });
}

function assertOpen(invitation: { token: string; status: string; expiresAt: Date }, token: string): void {
  // Sent again meanwhile: the link that located it is dead.
  if (invitation.token !== token) throw new InvitationNotFoundError();
  const standing = standingOf(invitation);
  if (standing === "revoked") throw new InvitationRevokedError();
  if (standing === "accepted") throw new InvitationAlreadyAcceptedError();
  if (standing === "expired") throw new InvitationExpiredError();
}

/**
 * The invited address, once the provider says this subject holds it, verified.
 * Undefined for a subject already linked to a User: that User's own address
 * answers, under lock.
 */
async function verifiedEmailOf(
  providerSubjectId: string,
  invitationId: string,
  token: string,
): Promise<string | undefined> {
  const [invitation] = await db
    .select()
    .from(invitations)
    .where(and(inWorkspace(invitations), eq(invitations.id, invitationId)))
    .limit(1);
  if (!invitation) throw new InvitationNotFoundError();
  assertOpen(invitation, token);

  const [linked] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.identityProviderSubjectId, providerSubjectId))
    .limit(1);
  if (linked) return undefined;

  let identity;
  try {
    identity = await identityProvider.findIdentityBySubjectId(providerSubjectId);
  } catch (error) {
    if (error instanceof IdentityProviderError) throw new InvitationUnauthorizedError();
    throw error;
  }
  if (!identity?.email) throw new InvitationUnauthorizedError();
  if (normalizeEmail(identity.email) !== normalizeEmail(invitation.email)) {
    throw new InvitationEmailMismatchError();
  }
  if (identity.emailVerified !== true) throw new InvitationUnverifiedEmailError();
  return normalizeEmail(identity.email);
}

type Invitee = { id: string; isArchived: boolean };

const inviteeColumns = {
  id: users.id,
  email: users.email,
  isArchived: users.isArchived,
  identityProviderSubjectId: users.identityProviderSubjectId,
};

async function linkedInvitee(tx: Tx, providerSubjectId: string, invitedEmail: string): Promise<Invitee | undefined> {
  const [bySubject] = await tx
    .select(inviteeColumns)
    .from(users)
    .where(eq(users.identityProviderSubjectId, providerSubjectId))
    .for("update");
  if (!bySubject) return undefined;
  if (normalizeEmail(bySubject.email) !== invitedEmail) throw new InvitationEmailMismatchError();
  return bySubject;
}

/**
 * The User this identity accepts as. Linking or creating one needs
 * `verifiedEmail`: the token alone is no proof, since a link can be forwarded.
 */
async function resolveInvitee(
  tx: Tx,
  providerSubjectId: string,
  email: string,
  verifiedEmail: string | undefined,
): Promise<Invitee> {
  const invitedEmail = normalizeEmail(email);
  const linked = await linkedInvitee(tx, providerSubjectId, invitedEmail);
  if (linked) return linked;
  if (verifiedEmail !== invitedEmail) throw new InvitationEmailMismatchError();

  // Addresses are unique with their case: the exact one first.
  const [byEmail] = await tx
    .select(inviteeColumns)
    .from(users)
    .where(sql`lower(${users.email}) = ${invitedEmail}`)
    .orderBy(sql`${users.email} = ${invitedEmail} desc`, asc(users.id))
    .limit(1)
    .for("update");
  if (byEmail) {
    if (byEmail.identityProviderSubjectId === providerSubjectId) return byEmail;
    if (byEmail.identityProviderSubjectId) throw new InvitationEmailMismatchError();
    await tx
      .update(users)
      .set({ identityProviderSubjectId: providerSubjectId, updatedAt: new Date() })
      .where(eq(users.id, byEmail.id));
    return byEmail;
  }

  const [created] = await tx
    .insert(users)
    .values({ email: invitedEmail, identityProviderSubjectId: providerSubjectId })
    .onConflictDoNothing()
    .returning(inviteeColumns);
  if (created) return created;
  // Registration wrote the same person's row first, in another tab.
  const raced = await linkedInvitee(tx, providerSubjectId, invitedEmail);
  if (!raced) throw new InvitationEmailMismatchError();
  return raced;
}

async function createOrRestoreMembership(tx: Tx, userId: string, workspaceRoleId: string): Promise<string> {
  const { workspaceId } = requireWorkspaceContext();
  const [existing] = await tx
    .select({ id: memberships.id, archivedAt: memberships.archivedAt })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.workspaceId, workspaceId)))
    .for("update");
  if (existing && existing.archivedAt == null) throw new InvitationDuplicateMembershipError();
  await assertSeatAvailable(tx);
  if (existing) {
    await tx
      .update(memberships)
      .set({ archivedAt: null, workspaceRoleId, updatedAt: new Date() })
      .where(eq(memberships.id, existing.id));
    return existing.id;
  }
  const [created] = await tx
    .insert(memberships)
    .values({
      workspaceId,
      userId,
      workspaceRoleId,
    })
    .returning({ id: memberships.id });
  return created.id;
}

/**
 * Workspace locators (#323, ADR-0006, migration 0041).
 *
 * Row-level security matches no row until `app.workspace_id` is set, and the
 * Workspace is not known until a User, Device, pairing code, API key, or
 * invitation has been resolved to one. These wrappers are that resolution: each
 * calls one SECURITY DEFINER function that looks a single key up across
 * Workspaces and returns a fixed column list. Everything after the lookup runs
 * inside `runWithWorkspaceContext`; nothing else reads across Workspaces.
 *
 * Timestamps come back the way drizzle's own selects return them: `Date`, or
 * `null` where the column is nullable.
 */

import { sql } from "drizzle-orm";
import { db } from "./db";

type Row = Record<string, unknown>;

async function call(fn: string, key: string): Promise<Row[]> {
  // `fn` is one of the literals below, never caller input.
  const result = await db.execute(sql`SELECT * FROM ${sql.raw(fn)}(${key})`);
  return result.rows as Row[];
}

/**
 * drizzle's node-postgres session hands `timestamp` columns back as text so it
 * can parse them as UTC itself; a plain driver returns a Date. Accept both.
 */
function toDate(value: unknown): Date {
  if (value instanceof Date) return value;
  const text = String(value);
  return new Date(/(?:Z|[+-]\d{2}(?::?\d{2})?)$/.test(text) ? text : `${text}+0000`);
}

function toDateOrNull(value: unknown): Date | null {
  return value === null || value === undefined ? null : toDate(value);
}

export interface LocatedMembership {
  id: string;
  workspaceId: string;
  userId: string;
  workspaceRoleId: string;
  archivedAt: Date | null;
  createdAt: Date | null;
}

/** Every Membership of the User, archived included. */
export async function membershipsForUser(userId: string): Promise<LocatedMembership[]> {
  const rows = await call("app_memberships_for_user", userId);
  return rows.map((row) => ({
    id: row.id as string,
    workspaceId: row.workspace_id as string,
    userId: row.user_id as string,
    workspaceRoleId: row.workspace_role_id as string,
    archivedAt: toDateOrNull(row.archived_at),
    createdAt: toDateOrNull(row.created_at),
  }));
}

export interface LocatedEnrollment {
  workspaceId: string;
  membershipId: string;
  userId: string;
  archivedAt: Date | null;
}

/** The Device Enrollment(s) of a Device, with the enrolled Membership's User and archive state. */
export async function enrollmentForDevice(deviceId: string): Promise<LocatedEnrollment[]> {
  const rows = await call("app_enrollment_for_device", deviceId);
  return rows.map((row) => ({
    workspaceId: row.workspace_id as string,
    membershipId: row.membership_id as string,
    userId: row.user_id as string,
    archivedAt: toDateOrNull(row.archived_at),
  }));
}

export interface LocatedPairingCode {
  id: string;
  workspaceId: string;
}

export async function workspaceForPairingCode(code: string): Promise<LocatedPairingCode | undefined> {
  const [row] = await call("app_workspace_for_pairing_code", code);
  return row && { id: row.id as string, workspaceId: row.workspace_id as string };
}

export interface LocatedServiceAccount {
  id: string;
  workspaceId: string;
  revokedAt: Date | null;
}

export async function workspaceForApiKey(keyHash: string): Promise<LocatedServiceAccount | undefined> {
  const [row] = await call("app_workspace_for_api_key", keyHash);
  return (
    row && {
      id: row.id as string,
      workspaceId: row.workspace_id as string,
      revokedAt: toDateOrNull(row.revoked_at),
    }
  );
}

export interface LocatedInvitation {
  id: string;
  workspaceId: string;
  status: string;
  expiresAt: Date;
}

/**
 * Pending, unexpired Invitations addressed to exactly this email (the match is
 * an exact string comparison, as `listInvitationsForEmail` has always made
 * it). The function filters, so an accepted or expired Invitation's Workspace
 * is never disclosed; the caller re-checks with the same rule.
 */
export async function invitationsForEmail(email: string): Promise<LocatedInvitation[]> {
  const rows = await call("app_invitations_for_email", email);
  return rows.map((row) => ({
    id: row.id as string,
    workspaceId: row.workspace_id as string,
    status: row.status as string,
    expiresAt: toDate(row.expires_at),
  }));
}

export interface LocatedInvitationToken {
  id: string;
  workspaceId: string;
}

export async function invitationForToken(token: string): Promise<LocatedInvitationToken | undefined> {
  const [row] = await call("app_invitation_for_token", token);
  return row && { id: row.id as string, workspaceId: row.workspace_id as string };
}

export interface LocatedTimeEntry {
  id: string;
  workspaceId: string;
}

/** The User's most recent running or paused Time Entry, whichever Workspace it is in. */
export async function activeTimeEntryForUser(userId: string): Promise<LocatedTimeEntry | undefined> {
  const [row] = await call("app_active_time_entry_for_user", userId);
  return row && { id: row.id as string, workspaceId: row.workspace_id as string };
}

/** The Workspace of a Time Entry, only when it belongs to this User. */
export async function timeEntryWorkspaceForUser(id: string, userId: string): Promise<string | undefined> {
  const result = await db.execute(sql`SELECT * FROM app_time_entry_workspace_for_user(${id}, ${userId})`);
  const [row] = result.rows as Row[];
  return row ? (row.workspace_id as string) : undefined;
}

/** The Workspace of a Notification, only when it is addressed to this User. */
export async function notificationWorkspaceForUser(id: string, userId: string): Promise<string | undefined> {
  const result = await db.execute(sql`SELECT * FROM app_notification_workspace_for_user(${id}, ${userId})`);
  const [row] = result.rows as Row[];
  return row ? (row.workspace_id as string) : undefined;
}

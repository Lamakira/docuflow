/**
 * The Workspace seam on every HTTP and Worker transaction (#95, ADR-0006).
 *
 * Context comes from the authenticated User's Membership (HTTP / agent) or the
 * Job's Workspace (Worker). Repositories read `workspaceId` from here — never
 * from an untrusted request body. Missing context fails closed.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { and, eq, isNull, type AnyColumn } from "drizzle-orm";
import { deviceEnrollments, memberships, workspaces, SEEDED_WORKSPACE_ID } from "@shared/schema";
import { db } from "./db";
import { setWorkspaceContextReader } from "./workspaceScope";

export interface WorkspaceContext {
  workspaceId: string;
  membershipId?: string;
  userId?: string;
}

export class MissingWorkspaceContextError extends Error {
  constructor() {
    super("WorkspaceContext is required");
    this.name = "MissingWorkspaceContextError";
  }
}

export class NoActiveMembershipError extends Error {
  constructor() {
    super("No active Membership in a Workspace");
    this.name = "NoActiveMembershipError";
  }
}

export class ArchivedMembershipError extends Error {
  constructor() {
    super("Archived Memberships cannot authenticate into the Workspace");
    this.name = "ArchivedMembershipError";
  }
}

const als = new AsyncLocalStorage<WorkspaceContext>();
setWorkspaceContextReader(() => als.getStore());

export function runWithWorkspaceContext<T>(ctx: WorkspaceContext, fn: () => T): T {
  return als.run(ctx, fn);
}

export function currentWorkspaceContext(): WorkspaceContext | undefined {
  return als.getStore();
}

export function requireWorkspaceContext(): WorkspaceContext {
  const ctx = als.getStore();
  if (!ctx) throw new MissingWorkspaceContextError();
  return ctx;
}

export function inWorkspace(table: { workspaceId: AnyColumn }) {
  return eq(table.workspaceId, requireWorkspaceContext().workspaceId);
}

export function stampWorkspace<T extends object>(values: T): T & { workspaceId: string } {
  return { ...values, workspaceId: requireWorkspaceContext().workspaceId };
}

export async function contextFromUser(userId: string): Promise<WorkspaceContext> {
  const active = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.userId, userId), isNull(memberships.archivedAt)));

  const membership =
    active.find((row) => row.workspaceId === SEEDED_WORKSPACE_ID) ?? active[0];

  if (membership) {
    return {
      workspaceId: membership.workspaceId,
      membershipId: membership.id,
      userId: membership.userId,
    };
  }

  const [archived] = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(eq(memberships.userId, userId))
    .limit(1);
  if (archived) throw new ArchivedMembershipError();
  throw new NoActiveMembershipError();
}

export async function contextFromDevice(
  deviceId: string,
  userId: string
): Promise<WorkspaceContext> {
  const [enrollment] = await db
    .select()
    .from(deviceEnrollments)
    .where(eq(deviceEnrollments.deviceId, deviceId))
    .limit(1);
  if (!enrollment) throw new NoActiveMembershipError();

  const [membership] = await db
    .select()
    .from(memberships)
    .where(eq(memberships.id, enrollment.membershipId))
    .limit(1);
  if (!membership || membership.userId !== userId) throw new NoActiveMembershipError();
  if (membership.archivedAt) throw new ArchivedMembershipError();

  return {
    workspaceId: enrollment.workspaceId,
    membershipId: membership.id,
    userId: membership.userId,
  };
}

export async function forEachWorkspace<T>(fn: () => Promise<T>): Promise<T[]> {
  const rows = await db.select({ id: workspaces.id }).from(workspaces);
  const out: T[] = [];
  for (const row of rows) {
    out.push(await runWithWorkspaceContext({ workspaceId: row.id }, fn));
  }
  return out;
}

export async function activeMemberUserIds(): Promise<Set<string>> {
  const { workspaceId } = requireWorkspaceContext();
  const rows = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.workspaceId, workspaceId), isNull(memberships.archivedAt)));
  return new Set(rows.map((row) => row.userId));
}

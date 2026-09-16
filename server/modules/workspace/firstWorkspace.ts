/**
 * Creating a Workspace (#217, Flow 1) and handing one on (Flow 10, step 1).
 *
 * This cannot be composed from `/api/*`: every existing Workspace read and
 * write is already bound to a Membership, and the User creating their first
 * Workspace has none. The route therefore reads the identity session and builds
 * its own context, exactly as Invitation acceptance does.
 *
 * The new Workspace enters `Trialing` as it is created (Flow 5). There is no
 * card step and no plan choice — the Trial is a DocuFlow state, not a Stripe
 * subscription (ADR-0010).
 */

import { randomUUID } from "node:crypto";
import { and, eq, isNull, ne } from "drizzle-orm";
import {
  auditEvents,
  capabilities,
  memberships,
  users,
  workspaceRoleCapabilities,
  workspaceRoles,
  workspaces,
} from "@shared/schema";
import { WORKSPACE_NAME_MAX, workspaceNameError } from "@shared/workspaceName";
import { db } from "../../db";
import { runWithWorkspaceContext, stampWorkspace } from "../../workspaceContext";
import { startTrial } from "../billing/stateMachine";
import { assertNoPendingAccountDeletion } from "./accountDeletion";
import { membershipRoleLabel, workspaceCondition } from "./activeWorkspace";

/** The built-in Workspace Roles every Workspace has (ADR-0004). No custom Roles. */
const BUILT_IN_ROLES = [
  { slug: "owner", name: "Owner" },
  { slug: "administrator", name: "Administrator" },
  { slug: "member", name: "Member" },
] as const;

/** Role grants the seeded Workspace carries, so a new one is not born poorer. */
const ROLE_CAPABILITIES: Record<string, string[]> = {
  owner: ["view_daily_updates"],
  administrator: ["view_daily_updates"],
  member: [],
};

export class InvalidWorkspaceNameError extends Error {
  readonly statusCode = 400;
  constructor(message = "Workspace name is required") {
    super(message);
    this.name = "InvalidWorkspaceNameError";
  }
}

export class WorkspaceNotOwnedError extends Error {
  readonly statusCode = 403;
  constructor() {
    super("Access denied");
    this.name = "WorkspaceNotOwnedError";
  }
}

export class WorkspaceSuccessorError extends Error {
  readonly statusCode = 400;
  constructor() {
    super("The new Owner must already hold an active Membership in this Workspace");
    this.name = "WorkspaceSuccessorError";
  }
}

export class WorkspaceHasMembersError extends Error {
  readonly statusCode = 409;
  constructor() {
    super("Transfer this Workspace — other Members still hold a Membership in it");
    this.name = "WorkspaceHasMembersError";
  }
}

export class WorkspaceConfirmationError extends Error {
  readonly statusCode = 400;
  constructor() {
    super("Type the Workspace name exactly to confirm");
    this.name = "WorkspaceConfirmationError";
  }
}

export type CreatedWorkspace = {
  workspaceId: string;
  workspaceName: string;
  workspaceRole: string;
  condition: string | null;
  trialEndsAt: Date | null;
};

function cleanName(raw: unknown): string {
  const name = typeof raw === "string" ? raw.trim() : "";
  const refusal = workspaceNameError(name);
  if (refusal === "too-long") {
    throw new InvalidWorkspaceNameError(`Workspace name is at most ${WORKSPACE_NAME_MAX} characters`);
  }
  if (refusal) throw new InvalidWorkspaceNameError();
  return name;
}

/**
 * The Workspace, its Roles, the creator's Owner Membership, and the Trial — one
 * transaction, because a half-built Workspace is one nobody can enter or fix.
 */
export async function createWorkspace(
  userId: string,
  input: { name: unknown },
): Promise<CreatedWorkspace> {
  const name = cleanName(input.name);
  // A standing intent to leave and a brand-new Workspace to own cannot both be
  // true: the deletion would archive the Owner Membership it was just given.
  await assertNoPendingAccountDeletion(userId);

  // The id is minted here rather than by the insert so the whole transaction can
  // run inside the new Workspace's context: `workspace_roles`, `memberships` and
  // `workspace_role_capabilities` are RLS-scoped, and a write with no
  // `app.workspace_id` fails closed once the application role is in use
  // (migration 0010).
  const workspaceId = randomUUID();

  await runWithWorkspaceContext({ workspaceId }, async () => {
    await db.transaction(async (tx) => {
      await tx.insert(workspaces).values({ id: workspaceId, name });

      const roles = await tx
        .insert(workspaceRoles)
        .values(
          BUILT_IN_ROLES.map((role) => ({
            workspaceId,
            slug: role.slug,
            name: role.name,
          })),
        )
        .returning({ id: workspaceRoles.id, slug: workspaceRoles.slug });

      const known = await tx.select({ id: capabilities.id }).from(capabilities);
      const knownIds = new Set(known.map((row) => row.id));
      const grants = roles.flatMap((role) =>
        (ROLE_CAPABILITIES[role.slug] ?? [])
          .filter((capabilityId) => knownIds.has(capabilityId))
          .map((capabilityId) => ({
            workspaceId,
            workspaceRoleId: role.id,
            capabilityId,
          })),
      );
      if (grants.length > 0) {
        await tx.insert(workspaceRoleCapabilities).values(grants);
      }

      const ownerRole = roles.find((role) => role.slug === "owner");
      if (!ownerRole) throw new Error("Workspace was created without an Owner Role");
      await tx.insert(memberships).values({
        workspaceId,
        userId,
        workspaceRoleId: ownerRole.id,
      });

      // The creator lands in what they just made, not in whatever they held before.
      await tx
        .update(users)
        .set({ activeWorkspaceId: workspaceId, updatedAt: new Date() })
        .where(eq(users.id, userId));
    });
  });

  // Flow 5 begins here. Outside the transaction above because the trial writes
  // its own audit row through the billing state machine.
  const projection = await runWithWorkspaceContext({ workspaceId }, async () => {
    const trial = await startTrial({ kind: "user", id: userId });
    await db.insert(auditEvents).values(
      stampWorkspace({
        actorKind: "user" as const,
        actorId: userId,
        action: "workspace.created",
        resourceType: "workspaces",
        resourceId: workspaceId,
        payload: { name },
      }),
    );
    return trial;
  });

  return {
    workspaceId,
    workspaceName: name,
    workspaceRole: membershipRoleLabel("owner"),
    condition: workspaceCondition(projection.billingState),
    trialEndsAt: projection.trialEndsAt ?? null,
  };
}

async function roleIdIn(workspaceId: string, slug: string): Promise<string> {
  const [role] = await db
    .select({ id: workspaceRoles.id })
    .from(workspaceRoles)
    .where(and(eq(workspaceRoles.workspaceId, workspaceId), eq(workspaceRoles.slug, slug)))
    .limit(1);
  if (!role) throw new Error(`Workspace ${workspaceId} has no ${slug} Role`);
  return role.id;
}

/** True when this User holds an active Owner Membership in that Workspace. */
export async function isWorkspaceOwner(userId: string, workspaceId: string): Promise<boolean> {
  const [row] = await db
    .select({ slug: workspaceRoles.slug })
    .from(memberships)
    .innerJoin(workspaceRoles, eq(workspaceRoles.id, memberships.workspaceRoleId))
    .where(
      and(
        eq(memberships.userId, userId),
        eq(memberships.workspaceId, workspaceId),
        isNull(memberships.archivedAt),
      ),
    )
    .limit(1);
  return row?.slug === "owner";
}

/**
 * Hand a Workspace on (Flow 10, step 1). The successor becomes Owner and the
 * departing Owner stays as an Administrator — losing ownership is not losing
 * the Membership, and their recorded work stays theirs.
 */
export async function transferWorkspaceOwnership(
  userId: string,
  workspaceId: string,
  successorUserId: string,
): Promise<{ workspaceId: string; ownerUserId: string }> {
  if (!(await isWorkspaceOwner(userId, workspaceId))) throw new WorkspaceNotOwnedError();
  if (successorUserId === userId) throw new WorkspaceSuccessorError();
  // Handing a Workspace to someone on their way out would leave it ownerless
  // the moment their window closes.
  await assertNoPendingAccountDeletion(successorUserId);

  const [successor] = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, successorUserId),
        eq(memberships.workspaceId, workspaceId),
        isNull(memberships.archivedAt),
      ),
    )
    .limit(1);
  if (!successor) throw new WorkspaceSuccessorError();

  const ownerRoleId = await roleIdIn(workspaceId, "owner");
  const administratorRoleId = await roleIdIn(workspaceId, "administrator");
  const now = new Date();

  await runWithWorkspaceContext({ workspaceId }, () =>
    db.transaction(async (tx) => {
      await tx
        .update(memberships)
        .set({ workspaceRoleId: administratorRoleId, updatedAt: now })
        .where(and(eq(memberships.userId, userId), eq(memberships.workspaceId, workspaceId)));
      await tx
        .update(memberships)
        .set({ workspaceRoleId: ownerRoleId, updatedAt: now })
        .where(eq(memberships.id, successor.id));
      await tx.insert(auditEvents).values(
        stampWorkspace({
          actorKind: "user" as const,
          actorId: userId,
          action: "workspace.ownership_transferred",
          resourceType: "workspaces",
          resourceId: workspaceId,
          payload: { from: userId, to: successorUserId },
        }),
      );
    }),
  );

  return { workspaceId, ownerUserId: successorUserId };
}

/**
 * Delete a Workspace (Flow 10, step 1, the other branch). Only its Owner, only
 * once they are its last active Member, and only on the typed name: deleting a
 * Workspace other people still belong to would purge records this User does not
 * control, which ADR-0015 forbids. Every workspace-scoped row cascades.
 */
export async function deleteWorkspace(
  userId: string,
  workspaceId: string,
  input: { confirmName: unknown },
): Promise<{ workspaceId: string; deleted: true }> {
  if (!(await isWorkspaceOwner(userId, workspaceId))) throw new WorkspaceNotOwnedError();

  const others = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(
      and(
        eq(memberships.workspaceId, workspaceId),
        ne(memberships.userId, userId),
        isNull(memberships.archivedAt),
      ),
    );
  if (others.length > 0) throw new WorkspaceHasMembersError();

  const [workspace] = await db
    .select({ name: workspaces.name })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  if (!workspace) throw new WorkspaceNotOwnedError();
  if (typeof input.confirmName !== "string" || input.confirmName !== workspace.name) {
    throw new WorkspaceConfirmationError();
  }

  // No Audit Event: `audit_events.workspace_id` is NOT NULL and cascades with
  // the Workspace, so evidence written here would be deleted along with what it
  // is evidence of. ADR-0015 wants workspace and platform scopes in one log;
  // the platform scope has no column yet, and inventing one is not this
  // ticket's. The refusals above are what stands in for it: only the Owner, and
  // only once they are the last Member.
  await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
  return { workspaceId, deleted: true };
}

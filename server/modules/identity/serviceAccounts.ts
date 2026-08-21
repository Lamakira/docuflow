/**
 * Service Account and PrincipalContext (#131, ADR-0008, ADR-0011).
 *
 * A Service Account is a non-human identity that acts in exactly one Workspace
 * through explicitly granted Capabilities. It is not a Member and does not
 * consume a Billable Seat. The API key is shown once, stored hashed, rotatable,
 * and revocable. A presented key maps to PrincipalContext or fails closed.
 */

import { createHash, randomBytes } from "node:crypto";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import {
  capabilities,
  memberships,
  serviceAccountCapabilities,
  serviceAccounts,
  workspaceRoles,
} from "@shared/schema";
import { db } from "../../db";
import {
  currentWorkspaceContext,
  inWorkspace,
  runWithWorkspaceContext,
  stampWorkspace,
} from "../../workspaceContext";

const KEY_PREFIX = "dfsa_";
const KEY_BYTES = 32;

export class UnknownCapabilityError extends Error {
  constructor() {
    super("Unknown capability");
    this.name = "UnknownCapabilityError";
  }
}

export class ServiceAccountNotFoundError extends Error {
  constructor() {
    super("Service Account not found");
    this.name = "ServiceAccountNotFoundError";
  }
}

export type PrincipalContext = {
  principal: { kind: "service_account"; serviceAccountId: string };
  workspaceId: string;
  capabilities: string[];
};

export type ServiceAccountView = {
  id: string;
  name: string;
  capabilityIds: string[];
  createdAt: Date | null;
  revokedAt: Date | null;
};

export type CreatedServiceAccount = ServiceAccountView & { plaintextKey: string };

export interface ServiceAccountPersistence {
  createServiceAccount(input: {
    name: string;
    capabilityIds?: string[];
  }): Promise<CreatedServiceAccount>;
  listServiceAccounts(): Promise<ServiceAccountView[]>;
  revokeServiceAccount(id: string): Promise<void>;
  rotateServiceAccountSecret(id: string): Promise<{ id: string; plaintextKey: string }>;
  principalContextFromApiKey(plaintextKey: string): Promise<PrincipalContext | null>;
}

function hashKey(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

function mintKey(): string {
  return `${KEY_PREFIX}${randomBytes(KEY_BYTES).toString("hex")}`;
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids)];
}

async function assertKnownCapabilities(capabilityIds: string[]): Promise<void> {
  if (capabilityIds.length === 0) return;
  const rows = await db
    .select({ id: capabilities.id })
    .from(capabilities)
    .where(inArray(capabilities.id, capabilityIds));
  if (rows.length !== capabilityIds.length) {
    throw new UnknownCapabilityError();
  }
}

function toView(
  row: { id: string; name: string; createdAt: Date | null; revokedAt: Date | null },
  capabilityIds: string[]
): ServiceAccountView {
  return {
    id: row.id,
    name: row.name,
    capabilityIds,
    createdAt: row.createdAt,
    revokedAt: row.revokedAt,
  };
}

async function grantsFor(accountIds: string[]): Promise<Map<string, string[]>> {
  const byAccount = new Map<string, string[]>();
  if (accountIds.length === 0) return byAccount;
  const rows = await db
    .select({
      serviceAccountId: serviceAccountCapabilities.serviceAccountId,
      capabilityId: serviceAccountCapabilities.capabilityId,
    })
    .from(serviceAccountCapabilities)
    .where(
      and(
        inArray(serviceAccountCapabilities.serviceAccountId, accountIds),
        inWorkspace(serviceAccountCapabilities)
      )
    );
  for (const row of rows) {
    const list = byAccount.get(row.serviceAccountId) ?? [];
    list.push(row.capabilityId);
    byAccount.set(row.serviceAccountId, list);
  }
  return byAccount;
}

export async function createServiceAccount(input: {
  name: string;
  capabilityIds?: string[];
}): Promise<CreatedServiceAccount> {
  const capabilityIds = uniqueIds(input.capabilityIds ?? []);
  await assertKnownCapabilities(capabilityIds);

  const plaintextKey = mintKey();
  const [row] = await db
    .insert(serviceAccounts)
    .values(
      stampWorkspace({
        name: input.name,
        keyHash: hashKey(plaintextKey),
      })
    )
    .returning();

  if (capabilityIds.length > 0) {
    await db.insert(serviceAccountCapabilities).values(
      capabilityIds.map((capabilityId) =>
        stampWorkspace({
          serviceAccountId: row.id,
          capabilityId,
        })
      )
    );
  }

  return { ...toView(row, capabilityIds), plaintextKey };
}

export async function listServiceAccounts(): Promise<ServiceAccountView[]> {
  const rows = await db
    .select()
    .from(serviceAccounts)
    .where(inWorkspace(serviceAccounts))
    .orderBy(asc(serviceAccounts.createdAt));
  const grants = await grantsFor(rows.map((row) => row.id));
  return rows.map((row) => toView(row, grants.get(row.id) ?? []));
}

export async function revokeServiceAccount(id: string): Promise<void> {
  const [row] = await db
    .update(serviceAccounts)
    .set({ revokedAt: new Date() })
    .where(and(eq(serviceAccounts.id, id), inWorkspace(serviceAccounts)))
    .returning({ id: serviceAccounts.id });
  if (!row) throw new ServiceAccountNotFoundError();
}

export async function rotateServiceAccountSecret(
  id: string
): Promise<{ id: string; plaintextKey: string }> {
  const [existing] = await db
    .select({ id: serviceAccounts.id })
    .from(serviceAccounts)
    .where(
      and(
        eq(serviceAccounts.id, id),
        inWorkspace(serviceAccounts),
        isNull(serviceAccounts.revokedAt)
      )
    );
  if (!existing) throw new ServiceAccountNotFoundError();

  const plaintextKey = mintKey();
  await db
    .update(serviceAccounts)
    .set({ keyHash: hashKey(plaintextKey) })
    .where(and(eq(serviceAccounts.id, id), inWorkspace(serviceAccounts)));
  return { id, plaintextKey };
}

/**
 * Map a presented API key to PrincipalContext. Missing, unknown, and revoked
 * keys fail closed. Lookup is by hash — the key names the Workspace. Grants
 * are then read inside that Workspace so listing cannot leak another tenant.
 */
export async function principalContextFromApiKey(
  plaintextKey: string
): Promise<PrincipalContext | null> {
  const [row] = await db
    .select()
    .from(serviceAccounts)
    .where(eq(serviceAccounts.keyHash, hashKey(plaintextKey)))
    .limit(1);
  if (!row || row.revokedAt) return null;

  return runWithWorkspaceContext({ workspaceId: row.workspaceId }, async () => {
    const grants = await grantsFor([row.id]);
    return {
      principal: { kind: "service_account" as const, serviceAccountId: row.id },
      workspaceId: row.workspaceId,
      capabilities: grants.get(row.id) ?? [],
    };
  });
}

/** Owner and Administrator may manage Service Accounts. Member may not. */
export async function canManageServiceAccounts(): Promise<boolean> {
  const ctx = currentWorkspaceContext();
  if (!ctx?.membershipId) return false;
  const [row] = await db
    .select({ slug: workspaceRoles.slug })
    .from(memberships)
    .innerJoin(workspaceRoles, eq(memberships.workspaceRoleId, workspaceRoles.id))
    .where(eq(memberships.id, ctx.membershipId));
  return row?.slug === "owner" || row?.slug === "administrator";
}

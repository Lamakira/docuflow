import { createHash } from "node:crypto";
import { eq, isNull } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  VIEW_DAILY_UPDATES_CAPABILITY_ID,
  memberships,
  serviceAccounts,
  SEEDED_WORKSPACE_ID,
  users,
  workspaceRoles,
  workspaces,
} from "../../shared/schema";
import { makeApp } from "../helpers/app";
import { newAgent, registerAdmin, registerUser, setWorkspaceRole } from "../helpers/auth";
import { resetDb } from "../helpers/db";
import { inSeededWorkspace } from "../helpers/workspace";

/**
 * Phase 7 ticket #131: Identity & Access owns Service Account and
 * PrincipalContext. HTTP characterization of `/api/*` and `/api/agent/*` is
 * not this suite — those contracts must not move. The seams here are the
 * identity module (create / hash / revoke / isolation) and the web BFF for a
 * Workspace administrator.
 */

const OTHER_WORKSPACE_ID = "other";

async function plantOtherWorkspace() {
  const { db } = await import("../../server/db");
  await db.insert(workspaces).values({ id: OTHER_WORKSPACE_ID, name: "Other" });
  await db.insert(workspaceRoles).values({
    id: "other-member",
    workspaceId: OTHER_WORKSPACE_ID,
    slug: "member",
    name: "Member",
  });
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

describe("Service Accounts (Identity & Access)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("creates a Service Account, shows the key once, and stores a hash", async () => {
    const { createServiceAccount, listServiceAccounts, principalContextFromApiKey } = await import(
      "../../server/modules/identity"
    );
    const { db } = await import("../../server/db");

    const created = await inSeededWorkspace(() =>
      createServiceAccount({
        name: "Billing export",
        capabilityIds: [VIEW_DAILY_UPDATES_CAPABILITY_ID],
      })
    );

    expect(created).toMatchObject({
      name: "Billing export",
      capabilityIds: [VIEW_DAILY_UPDATES_CAPABILITY_ID],
      revokedAt: null,
    });
    expect(created.plaintextKey.startsWith("dfsa_")).toBe(true);
    expect(created).not.toHaveProperty("keyHash");

    const listed = await inSeededWorkspace(() => listServiceAccounts());
    expect(listed).toEqual([
      {
        id: created.id,
        name: "Billing export",
        capabilityIds: [VIEW_DAILY_UPDATES_CAPABILITY_ID],
        createdAt: created.createdAt,
        revokedAt: null,
      },
    ]);
    expect(listed[0]).not.toHaveProperty("plaintextKey");
    expect(listed[0]).not.toHaveProperty("keyHash");

    const [row] = await db
      .select()
      .from(serviceAccounts)
      .where(eq(serviceAccounts.id, created.id));
    expect(row.keyHash).toBe(sha256(created.plaintextKey));
    expect(row.keyHash).not.toBe(created.plaintextKey);

    const ctx = await principalContextFromApiKey(created.plaintextKey);
    expect(ctx).toEqual({
      principal: { kind: "service_account", serviceAccountId: created.id },
      workspaceId: SEEDED_WORKSPACE_ID,
      capabilities: [VIEW_DAILY_UPDATES_CAPABILITY_ID],
    });
  });

  it("maps a presented key to PrincipalContext in that Workspace or fails closed, and revoke ends access immediately", async () => {
    const { createServiceAccount, principalContextFromApiKey, revokeServiceAccount } = await import(
      "../../server/modules/identity"
    );

    const created = await inSeededWorkspace(() =>
      createServiceAccount({ name: "CRM sync", capabilityIds: [] })
    );

    await expect(principalContextFromApiKey("dfsa_not-a-real-key")).resolves.toBeNull();
    await expect(principalContextFromApiKey(created.plaintextKey)).resolves.toMatchObject({
      principal: { kind: "service_account", serviceAccountId: created.id },
      workspaceId: SEEDED_WORKSPACE_ID,
    });

    await inSeededWorkspace(() => revokeServiceAccount(created.id));

    await expect(principalContextFromApiKey(created.plaintextKey)).resolves.toBeNull();
  });

  it("rotates the secret, retires the old hash, and never creates a Membership or Billable Seat", async () => {
    const { createServiceAccount, rotateServiceAccountSecret, principalContextFromApiKey } =
      await import("../../server/modules/identity");
    const { db } = await import("../../server/db");

    const seatsBefore = await db
      .select({ id: memberships.id })
      .from(memberships)
      .where(isNull(memberships.archivedAt));

    const created = await inSeededWorkspace(() =>
      createServiceAccount({ name: "Docs export", capabilityIds: [] })
    );
    const rotated = await inSeededWorkspace(() => rotateServiceAccountSecret(created.id));

    expect(rotated.plaintextKey).not.toBe(created.plaintextKey);
    await expect(principalContextFromApiKey(created.plaintextKey)).resolves.toBeNull();
    await expect(principalContextFromApiKey(rotated.plaintextKey)).resolves.toMatchObject({
      principal: { kind: "service_account", serviceAccountId: created.id },
    });

    const seatsAfter = await db
      .select({ id: memberships.id })
      .from(memberships)
      .where(isNull(memberships.archivedAt));
    expect(seatsAfter).toEqual(seatsBefore);

    const [asUser] = await db.select({ id: users.id }).from(users).where(eq(users.id, created.id));
    expect(asUser).toBeUndefined();
    const [asMember] = await db
      .select({ id: memberships.id })
      .from(memberships)
      .where(eq(memberships.userId, created.id));
    expect(asMember).toBeUndefined();
  });

  it("does not let a Service Account read another Workspace", async () => {
    const { storage } = await import("../../server/storage");
    const { runWithWorkspaceContext } = await import("../../server/workspaceContext");
    const { createServiceAccount, listServiceAccounts, principalContextFromApiKey } = await import(
      "../../server/modules/identity"
    );
    const { db } = await import("../../server/db");

    await plantOtherWorkspace();

    const other = await storage.createUser({
      email: "other@test.invalid",
      password: "not-a-real-hash",
      firstName: "Other",
    });
    await db.delete(memberships).where(eq(memberships.userId, other.id));
    await db.insert(memberships).values({
      workspaceId: OTHER_WORKSPACE_ID,
      userId: other.id,
      workspaceRoleId: "other-member",
    });

    const theirs = await runWithWorkspaceContext({ workspaceId: OTHER_WORKSPACE_ID }, () =>
      storage.createProject({ name: "Theirs", ownerId: other.id })
    );
    const theirAccount = await runWithWorkspaceContext({ workspaceId: OTHER_WORKSPACE_ID }, () =>
      createServiceAccount({ name: "Other export", capabilityIds: [] })
    );

    const ours = await inSeededWorkspace(() =>
      createServiceAccount({ name: "Ours", capabilityIds: [] })
    );
    const ctx = await principalContextFromApiKey(ours.plaintextKey);
    expect(ctx?.workspaceId).toBe(SEEDED_WORKSPACE_ID);

    const theirsCtx = await principalContextFromApiKey(theirAccount.plaintextKey);
    expect(theirsCtx?.workspaceId).toBe(OTHER_WORKSPACE_ID);

    const visible = await runWithWorkspaceContext({ workspaceId: ctx!.workspaceId }, async () => ({
      projects: await storage.getProjects(),
      accounts: await listServiceAccounts(),
    }));

    expect(visible.projects.map((row) => row.id)).not.toContain(theirs.id);
    expect(visible.accounts.map((row) => row.id)).toEqual([ours.id]);
    expect(visible.accounts.map((row) => row.id)).not.toContain(theirAccount.id);

    const fromTheirs = await runWithWorkspaceContext({ workspaceId: theirsCtx!.workspaceId }, () =>
      listServiceAccounts()
    );
    expect(fromTheirs.map((row) => row.id)).toEqual([theirAccount.id]);
    expect(fromTheirs.map((row) => row.id)).not.toContain(ours.id);
  });
});

describe("Service Account web BFF", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("lets a Workspace administrator create, list, and revoke through /api/service-accounts", async () => {
    const app = await makeApp();
    const admin = await registerUser(app);
    await setWorkspaceRole(admin.id, "administrator");
    const { principalContextFromApiKey } = await import("../../server/modules/identity");

    const created = await admin.agent.post("/api/service-accounts").send({
      name: "Invoices",
      capabilityIds: [VIEW_DAILY_UPDATES_CAPABILITY_ID],
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      name: "Invoices",
      capabilityIds: [VIEW_DAILY_UPDATES_CAPABILITY_ID],
      revokedAt: null,
    });
    expect(typeof created.body.plaintextKey).toBe("string");
    expect(created.body).not.toHaveProperty("keyHash");

    const listed = await admin.agent.get("/api/service-accounts");
    expect(listed.status).toBe(200);
    expect(listed.body).toEqual([
      expect.objectContaining({
        id: created.body.id,
        name: "Invoices",
      }),
    ]);
    expect(listed.body[0]).not.toHaveProperty("plaintextKey");
    expect(listed.body[0]).not.toHaveProperty("keyHash");

    const revoked = await admin.agent.post(`/api/service-accounts/${created.body.id}/revoke`);
    expect(revoked.status).toBe(200);
    expect(revoked.body).toEqual({ ok: true });

    await expect(principalContextFromApiKey(created.body.plaintextKey)).resolves.toBeNull();
  });

  it("rejects a Member and a users.role admin who is not a Workspace administrator", async () => {
    const app = await makeApp();
    const member = await registerUser(app);
    const platformAdmin = await registerAdmin(app);

    const asMember = await member.agent.post("/api/service-accounts").send({ name: "Nope" });
    expect(asMember.status).toBe(403);
    expect(asMember.body).toEqual({ message: "Access denied" });

    const asPlatformAdmin = await platformAdmin.agent.get("/api/service-accounts");
    expect(asPlatformAdmin.status).toBe(403);
    expect(asPlatformAdmin.body).toEqual({ message: "Access denied" });
  });

  it("leaves session auth and Device auth unchanged: a Service Account key is not valid on /api/*", async () => {
    const app = await makeApp();
    const admin = await registerUser(app);
    await setWorkspaceRole(admin.id, "owner");

    const created = await admin.agent.post("/api/service-accounts").send({ name: "Key" });
    expect(created.status).toBe(201);

    const withKey = await admin.agent
      .get("/api/projects")
      .set("x-api-key", created.body.plaintextKey);
    // Session cookie on this agent still authenticates; the Service Account key
    // must not impersonate anyone on `/api/*`.
    expect(withKey.status).toBe(200);

    const anonymous = await newAgent(app)
      .get("/api/projects")
      .set("x-api-key", created.body.plaintextKey);
    expect(anonymous.status).toBe(401);
    expect(anonymous.body).toEqual({ message: "Unauthorized" });

    const agentRoute = await newAgent(app)
      .post("/api/agent/heartbeat")
      .set("x-api-key", created.body.plaintextKey)
      .send({});
    expect(agentRoute.status).toBe(401);
  });
});

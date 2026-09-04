import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../helpers/db";
import { FakeIdentityProvider } from "../fakes/identityProvider";
import type {
  ImportableUser,
  UserImportPersistence,
} from "../../server/modules/identity/userImport";

/**
 * Phase 5 ticket #108, updated by #161: classify remaining Users for the
 * IdentityProvider (ADR-0007, ADR-0017).
 *
 * Hashes are gone from `users`, so nobody is imported by digest. The seam is
 * the classification over the port plus the `users.identity_provider_subject_id`
 * link. Clerk is never reached — the port fake answers.
 */

function importable(overrides: Partial<ImportableUser> = {}): ImportableUser {
  return {
    id: "user-1",
    email: "ada@example.com",
    firstName: "Ada",
    lastName: "Lovelace",
    identityProviderSubjectId: null,
    ...overrides,
  };
}

/** In-memory persistence so the use case is exercised without a database. */
class FakeUserImportPersistence implements UserImportPersistence {
  readonly links: Array<{ userId: string; providerSubjectId: string }> = [];

  constructor(private readonly rows: ImportableUser[]) {}

  async listUsersForIdentityImport(): Promise<ImportableUser[]> {
    return this.rows.map((row) => ({ ...row }));
  }

  async linkUserToIdentityProvider(userId: string, providerSubjectId: string): Promise<void> {
    this.links.push({ userId, providerSubjectId });
    const row = this.rows.find((candidate) => candidate.id === userId);
    if (row) row.identityProviderSubjectId = providerSubjectId;
  }
}

describe("User import into the IdentityProvider", () => {
  it("lists an unlinked User for a password-set invite instead of importing a digest", async () => {
    const { importUsersIntoIdentityProvider } = await import(
      "../../server/modules/identity/userImport"
    );
    const persistence = new FakeUserImportPersistence([importable()]);
    const provider = new FakeIdentityProvider();

    const report = await importUsersIntoIdentityProvider({ persistence, provider });

    expect(report.counts).toEqual({
      alreadyLinked: 0,
      passwordSetInvite: 1,
    });
    expect(report.passwordSetInvites).toEqual(["ada@example.com"]);
    expect(report.remainingToImport).toBe(0);
    expect(provider.imports).toEqual([]);
    expect(persistence.links).toEqual([]);
  });

  it("is idempotent: a linked User short-circuits before the port", async () => {
    const { importUsersIntoIdentityProvider } = await import(
      "../../server/modules/identity/userImport"
    );
    const persistence = new FakeUserImportPersistence([
      importable({ identityProviderSubjectId: "user_fake_1" }),
    ]);
    const provider = new FakeIdentityProvider();

    const report = await importUsersIntoIdentityProvider({ persistence, provider });

    expect(report.counts).toEqual({
      alreadyLinked: 1,
      passwordSetInvite: 0,
    });
    expect(provider.imports).toEqual([]);
    expect(persistence.links).toEqual([]);
  });

  it("does not reach a closed provider, because hashes are gone", async () => {
    const { importUsersIntoIdentityProvider } = await import(
      "../../server/modules/identity/userImport"
    );
    const { createIdentityProvider } = await import("../../server/modules/identity");
    const persistence = new FakeUserImportPersistence([importable()]);

    const report = await importUsersIntoIdentityProvider({
      persistence,
      provider: createIdentityProvider({ secretKey: undefined }),
    });
    expect(report.passwordSetInvites).toEqual(["ada@example.com"]);
    expect(persistence.links).toEqual([]);
  });

  it("plans the same classification without calling the provider", async () => {
    const { planUserImport } = await import("../../server/modules/identity/userImport");
    const persistence = new FakeUserImportPersistence([
      importable({ id: "ready-1", email: "ready@example.com" }),
      importable({
        id: "linked-1",
        email: "linked@example.com",
        identityProviderSubjectId: "user_clerk_9",
      }),
    ]);

    await expect(planUserImport(persistence)).resolves.toEqual([
      { userId: "ready-1", email: "ready@example.com", action: "password-set-invite" },
      { userId: "linked-1", email: "linked@example.com", action: "already-linked" },
    ]);
  });
});

describe("identity:import:users output", () => {
  it("names the Users a password-set invite is owed, in both the plan and the report", async () => {
    const { formatPlan, formatReport } = await import("../../scripts/identity-import-users");

    const plan = formatPlan([
      { userId: "oidc-1", email: "oidc@example.com", action: "password-set-invite" },
      { userId: "linked-1", email: "linked@example.com", action: "already-linked" },
    ]);

    expect(plan).toContain("Users: 2");
    expect(plan).toContain("Password-set invite (no digest on the User, not imported):");
    expect(plan).toContain("oidc@example.com");
    expect(plan).not.toContain("linked@example.com");

    const report = formatReport({
      outcomes: [
        { userId: "oidc-1", email: "oidc@example.com", status: "password-set-invite" },
      ],
      passwordSetInvites: ["oidc@example.com"],
      counts: { alreadyLinked: 0, passwordSetInvite: 1 },
      remainingToImport: 0,
    });

    expect(report).toContain("oidc@example.com");
  });
});

describe("User import against the database", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("lists an unlinked User for a password-set invite and does not write a link", async () => {
    const { createUnlinkedUser } = await import("../helpers/auth");
    const { storage } = await import("../../server/storage");
    const { importUsersIntoIdentityProvider } = await import(
      "../../server/modules/identity/userImport"
    );
    const user = await createUnlinkedUser();
    const provider = new FakeIdentityProvider();

    const first = await importUsersIntoIdentityProvider({ persistence: storage, provider });

    const after = await storage.getUser(user.id);
    expect(first.passwordSetInvites).toEqual([user.email]);
    expect(first.counts.passwordSetInvite).toBeGreaterThanOrEqual(1);
    expect(after?.identityProviderSubjectId).toBeNull();
    expect(provider.imports).toEqual([]);

    const second = await importUsersIntoIdentityProvider({ persistence: storage, provider });
    expect(second.passwordSetInvites).toContain(user.email);
    expect(provider.imports).toEqual([]);
  });

  it("keeps the provider subject id off every User the API returns", async () => {
    const { makeApp } = await import("../helpers/app");
    const { registerAdmin, registerUser } = await import("../helpers/auth");
    const { storage } = await import("../../server/storage");
    const { importUsersIntoIdentityProvider } = await import(
      "../../server/modules/identity/userImport"
    );
    const app = await makeApp();
    const admin = await registerAdmin(app);
    const member = await registerUser(app);

    await importUsersIntoIdentityProvider({
      persistence: storage,
      provider: new FakeIdentityProvider(),
    });
    const subjectId = (await storage.getUser(member.id))?.identityProviderSubjectId;
    expect(subjectId).toEqual(expect.any(String));

    const responses = [
      await member.agent.get("/api/users"),
      await admin.agent.get("/api/auth/user"),
      await admin.agent.get(`/api/admin/users/${member.id}`),
      await admin.agent.patch(`/api/admin/users/${member.id}/role`).send({ role: "admin" }),
      await admin.agent.patch(`/api/admin/users/${member.id}/archive`).send({ isArchived: true }),
    ];

    for (const response of responses) {
      expect(response.status).toBe(200);
      expect(JSON.stringify(response.body)).not.toContain("identityProviderSubjectId");
      expect(JSON.stringify(response.body)).not.toContain(subjectId);
    }
  });

  it("lists an unlinked User for a password-set invite and leaves it unlinked", async () => {
    const { storage } = await import("../../server/storage");
    const { importUsersIntoIdentityProvider } = await import(
      "../../server/modules/identity/userImport"
    );
    const oidc = await storage.upsertUser({
      id: "oidc-subject-1",
      email: "oidc@test.invalid",
      firstName: "Odette",
    });
    const provider = new FakeIdentityProvider();

    const report = await importUsersIntoIdentityProvider({ persistence: storage, provider });

    expect(report.passwordSetInvites).toContain("oidc@test.invalid");
    expect(provider.imports).toEqual([]);
    const after = await storage.getUser(oidc.id);
    expect(after?.identityProviderSubjectId).toBeNull();
  });

  it("leaves Membership and Devices untouched", async () => {
    const { makeApp } = await import("../helpers/app");
    const { createUnlinkedUser, signIn } = await import("../helpers/auth");
    const { loginDevice } = await import("../helpers/agent");
    const { storage } = await import("../../server/storage");
    const { pool } = await import("../../server/db");
    const { importUsersIntoIdentityProvider } = await import(
      "../../server/modules/identity/userImport"
    );
    const app = await makeApp();
    const user = await createUnlinkedUser();
    const device = await loginDevice(app, { ...user, agent: await signIn(app, user.id) });
    await pool.query(`UPDATE users SET identity_provider_subject_id = NULL WHERE id = $1`, [user.id]);
    const membershipsBefore = await pool.query(
      `SELECT id, user_id, workspace_id, workspace_role_id, archived_at FROM memberships ORDER BY id`
    );

    await importUsersIntoIdentityProvider({ persistence: storage, provider: new FakeIdentityProvider() });

    const membershipsAfter = await pool.query(
      `SELECT id, user_id, workspace_id, workspace_role_id, archived_at FROM memberships ORDER BY id`
    );
    expect(membershipsAfter.rows).toEqual(membershipsBefore.rows);
    const capabilities = await device.request.get("/api/agent/capabilities");
    expect(capabilities.status).toBe(200);
    await expect(storage.getDevice(device.deviceId)).resolves.toMatchObject({
      id: device.deviceId,
      revokedAt: null,
    });
  });
});

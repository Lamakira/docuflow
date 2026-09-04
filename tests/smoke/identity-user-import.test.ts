import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../helpers/db";
import { FakeIdentityProvider } from "../fakes/identityProvider";
import type {
  ImportableUser,
  UserImportPersistence,
} from "../../server/modules/identity/userImport";

/**
 * Phase 5 ticket #108: import existing Users into the IdentityProvider by bcrypt
 * hash (ADR-0007, ADR-0017).
 *
 * Seams: the import use case over the IdentityProvider port, and the
 * `users.identity_provider_subject_id` link it writes back. Clerk is never
 * reached — the port fake answers. Characterization of `/api/auth/*` stays away:
 * `users.password` and the current login path are untouched by this ticket.
 */

/** Independent known-good: bcrypt of `password123` at cost 4. */
const PASSWORD = "password123";
const BCRYPT_HASH = "$2b$04$CJHjh937SDvS7hh3rhGtDeDrY0sTbWMloGRi22XPxY7Zb9scpnnj2";

/** What `storage.upsertUser` writes for a Replit OIDC User: not a hash at all. */
const OIDC_PLACEHOLDER = "REPLIT_OIDC_USER";

function importable(overrides: Partial<ImportableUser> = {}): ImportableUser {
  return {
    id: "user-1",
    email: "ada@example.com",
    password: BCRYPT_HASH,
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
  it("imports a User with a bcrypt hash and links it by provider subject id", async () => {
    const { importUsersIntoIdentityProvider } = await import(
      "../../server/modules/identity/userImport"
    );
    const persistence = new FakeUserImportPersistence([importable()]);
    const provider = new FakeIdentityProvider();

    const report = await importUsersIntoIdentityProvider({ persistence, provider });

    expect(report.counts).toEqual({
      linked: 1,
      alreadyLinked: 0,
      passwordSetInvite: 0,
      failed: 0,
    });
    // Verifier: re-read after the run, nothing importable is left behind.
    expect(report.remainingToImport).toBe(0);
    expect(persistence.links).toEqual([
      { userId: "user-1", providerSubjectId: "user_fake_1" },
    ]);
    expect(provider.imports).toEqual([
      {
        email: "ada@example.com",
        passwordHash: BCRYPT_HASH,
        firstName: "Ada",
        lastName: "Lovelace",
      },
    ]);
  });

  it("authenticates the imported User through the port without a password reset", async () => {
    const { importUsersIntoIdentityProvider } = await import(
      "../../server/modules/identity/userImport"
    );
    const persistence = new FakeUserImportPersistence([importable()]);
    const provider = new FakeIdentityProvider();

    await importUsersIntoIdentityProvider({ persistence, provider });

    await expect(provider.authenticate("ada@example.com", PASSWORD)).resolves.toEqual({
      providerSubjectId: "user_fake_1",
      email: "ada@example.com",
    });
  });

  it("is idempotent: a second run creates no second provider User", async () => {
    const { importUsersIntoIdentityProvider } = await import(
      "../../server/modules/identity/userImport"
    );
    const persistence = new FakeUserImportPersistence([importable()]);
    const provider = new FakeIdentityProvider();

    const first = await importUsersIntoIdentityProvider({ persistence, provider });
    const second = await importUsersIntoIdentityProvider({ persistence, provider });

    expect(first.counts.linked).toBe(1);
    expect(second.counts).toEqual({
      linked: 0,
      alreadyLinked: 1,
      passwordSetInvite: 0,
      failed: 0,
    });
    // The link short-circuits before the port, so the provider is not called twice.
    expect(provider.imports).toHaveLength(1);
    expect(persistence.links).toHaveLength(1);
    expect(second.outcomes[0].providerSubjectId).toBe("user_fake_1");
  });

  it("reuses the provider subject when a previous run created it but never wrote the link", async () => {
    const { importUsersIntoIdentityProvider } = await import(
      "../../server/modules/identity/userImport"
    );
    const persistence = new FakeUserImportPersistence([importable()]);
    const provider = new FakeIdentityProvider();
    // The window a crash leaves behind: the provider User exists, the link does not.
    const link = persistence.linkUserToIdentityProvider.bind(persistence);
    persistence.linkUserToIdentityProvider = async () => {
      throw new Error("connection lost");
    };
    const crashed = await importUsersIntoIdentityProvider({ persistence, provider });
    expect(crashed.counts.failed).toBe(1);
    expect(crashed.remainingToImport).toBe(1);
    persistence.linkUserToIdentityProvider = link;

    const resumed = await importUsersIntoIdentityProvider({ persistence, provider });

    expect(resumed.counts.linked).toBe(1);
    expect(resumed.remainingToImport).toBe(0);
    // Re-import by email resolves to the User the crashed run created, not a second one.
    expect(provider.imports).toHaveLength(2);
    expect(persistence.links).toEqual([
      { userId: "user-1", providerSubjectId: "user_fake_1" },
    ]);
  });

  it("lists a User with no usable hash for a password-set invite instead of importing one", async () => {
    const { importUsersIntoIdentityProvider } = await import(
      "../../server/modules/identity/userImport"
    );
    const persistence = new FakeUserImportPersistence([
      importable({ id: "oidc-1", email: "oidc@example.com", password: OIDC_PLACEHOLDER }),
      importable({ id: "empty-1", email: "empty@example.com", password: "" }),
    ]);
    const provider = new FakeIdentityProvider();

    const report = await importUsersIntoIdentityProvider({ persistence, provider });

    expect(report.passwordSetInvites).toEqual(["oidc@example.com", "empty@example.com"]);
    expect(report.counts.passwordSetInvite).toBe(2);
    // An invite is an expected leftover, not an unfinished import.
    expect(report.remainingToImport).toBe(0);
    // No password is invented for them, and the port is never asked to import one.
    expect(provider.imports).toEqual([]);
    expect(persistence.links).toEqual([]);
  });

  it("records a failing User and keeps importing the rest", async () => {
    const { importUsersIntoIdentityProvider } = await import(
      "../../server/modules/identity/userImport"
    );
    const { IdentityProviderError } = await import(
      "../../server/modules/identity/identityProvider"
    );
    const persistence = new FakeUserImportPersistence([
      importable({ id: "bad-1", email: "bad@example.com" }),
      importable({ id: "good-1", email: "good@example.com" }),
    ]);
    const provider = new FakeIdentityProvider();
    const importPasswordUser = provider.importPasswordUser.bind(provider);
    provider.importPasswordUser = async (request) => {
      if (request.email === "bad@example.com") {
        throw new IdentityProviderError("Clerk said no");
      }
      return importPasswordUser(request);
    };

    const report = await importUsersIntoIdentityProvider({ persistence, provider });

    expect(report.counts).toEqual({
      linked: 1,
      alreadyLinked: 0,
      passwordSetInvite: 0,
      failed: 1,
    });
    expect(report.outcomes[0]).toMatchObject({
      email: "bad@example.com",
      status: "failed",
      detail: "Clerk said no",
    });
    // Verifier: the failed User is still waiting, so the run is not done.
    expect(report.remainingToImport).toBe(1);
    expect(persistence.links).toEqual([
      { userId: "good-1", providerSubjectId: "user_fake_1" },
    ]);
  });

  it("stops the run when the provider has no credentials rather than failing every User", async () => {
    const { importUsersIntoIdentityProvider } = await import(
      "../../server/modules/identity/userImport"
    );
    const { IdentityProviderClosedError, createIdentityProvider } = await import(
      "../../server/modules/identity"
    );
    const persistence = new FakeUserImportPersistence([importable()]);

    await expect(
      importUsersIntoIdentityProvider({
        persistence,
        provider: createIdentityProvider({ secretKey: undefined }),
      })
    ).rejects.toBeInstanceOf(IdentityProviderClosedError);
    expect(persistence.links).toEqual([]);
  });

  it("plans the same classification without calling the provider", async () => {
    const { planUserImport } = await import("../../server/modules/identity/userImport");
    const persistence = new FakeUserImportPersistence([
      importable({ id: "ready-1", email: "ready@example.com" }),
      importable({ id: "oidc-1", email: "oidc@example.com", password: OIDC_PLACEHOLDER }),
      importable({
        id: "linked-1",
        email: "linked@example.com",
        identityProviderSubjectId: "user_clerk_9",
      }),
    ]);

    await expect(planUserImport(persistence)).resolves.toEqual([
      { userId: "ready-1", email: "ready@example.com", action: "import" },
      { userId: "oidc-1", email: "oidc@example.com", action: "password-set-invite" },
      { userId: "linked-1", email: "linked@example.com", action: "already-linked" },
    ]);
  });
});

describe("identity:import:users output", () => {
  it("names the Users a password-set invite is owed, in both the plan and the report", async () => {
    const { formatPlan, formatReport } = await import("../../scripts/identity-import-users");

    const plan = formatPlan([
      { userId: "ready-1", email: "ready@example.com", action: "import" },
      { userId: "oidc-1", email: "oidc@example.com", action: "password-set-invite" },
      { userId: "linked-1", email: "linked@example.com", action: "already-linked" },
    ]);

    expect(plan).toContain("Users: 3");
    expect(plan).toContain("Password-set invite (no usable hash, not imported):");
    expect(plan).toContain("oidc@example.com");
    expect(plan).not.toContain("ready@example.com");

    const report = formatReport({
      outcomes: [
        { userId: "bad-1", email: "bad@example.com", status: "failed", detail: "Clerk said no" },
      ],
      passwordSetInvites: ["oidc@example.com"],
      counts: { linked: 0, alreadyLinked: 0, passwordSetInvite: 1, failed: 1 },
      remainingToImport: 1,
    });

    expect(report).toContain("oidc@example.com");
    expect(report).toContain("bad@example.com\tClerk said no");
  });
});

describe("User import against the database", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("links an unlinked User, leaves the password, and no-ops on a second run", async () => {
    const { createUnlinkedUser } = await import("../helpers/auth");
    const { storage } = await import("../../server/storage");
    const { importUsersIntoIdentityProvider } = await import(
      "../../server/modules/identity/userImport"
    );
    // Unlinked on purpose: this is the state the import exists to change, and
    // it is what every User was in before Phase 5 (#110 made a signed-in User a
    // linked one, so the ordinary fixture arrives already imported).
    const user = await createUnlinkedUser();
    const before = await storage.getUserWithPassword(user.id);
    const provider = new FakeIdentityProvider();

    const first = await importUsersIntoIdentityProvider({ persistence: storage, provider });

    const linked = await storage.getUserWithPassword(user.id);
    expect(first.counts.linked).toBe(1);
    expect(linked?.identityProviderSubjectId).toBe("user_fake_1");
    // The row's own bcrypt hash is what was imported, and it is left in place.
    expect(provider.imports[0].passwordHash).toBe(before?.password);
    expect(linked?.password).toBe(before?.password);
    // Imported without a reset: the registration password still authenticates.
    await expect(provider.authenticate(user.email, user.password)).resolves.toEqual({
      providerSubjectId: "user_fake_1",
      email: user.email,
    });

    const second = await importUsersIntoIdentityProvider({ persistence: storage, provider });

    expect(second.counts).toEqual({
      linked: 0,
      alreadyLinked: 1,
      passwordSetInvite: 0,
      failed: 0,
    });
    expect(provider.imports).toHaveLength(1);
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
    // Signing in linked them already (#110), so this is the subject id the API
    // must not leak — read from the row rather than assumed from a fixture.
    const subjectId = (await storage.getUserWithPassword(member.id))?.identityProviderSubjectId;
    expect(subjectId).toEqual(expect.any(String));

    // Every shape the admin surfaces hand back: the directory, the detail view,
    // and the two writes that return the row they just updated.
    const responses = [
      await member.agent.get("/api/users"),
      await admin.agent.get("/api/auth/user"),
      await admin.agent.get(`/api/admin/users/${member.id}`),
      await admin.agent.patch(`/api/admin/users/${member.id}/role`).send({ role: "admin" }),
      await admin.agent.patch(`/api/admin/users/${member.id}/archive`).send({ isArchived: true }),
    ];

    for (const response of responses) {
      expect(response.status).toBe(200);
      // The link is a server-side identity concern; no client learns it.
      expect(JSON.stringify(response.body)).not.toContain("identityProviderSubjectId");
      expect(JSON.stringify(response.body)).not.toContain(subjectId);
    }
  });

  it("lists an OIDC-only User for a password-set invite and leaves it unlinked", async () => {
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

    expect(report.passwordSetInvites).toEqual(["oidc@test.invalid"]);
    expect(provider.imports).toEqual([]);
    const after = await storage.getUserWithPassword(oidc.id);
    expect(after?.identityProviderSubjectId).toBeNull();
    expect(after?.password).toBe(OIDC_PLACEHOLDER);
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
    // Unlinked, so the import below has something to do rather than no-opping.
    // Pairing needs a web session, which links; clear the subject after enroll
    // so import still runs against this User.
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
    // The enrolled device's bearer token still opens the agent door.
    const capabilities = await device.request.get("/api/agent/capabilities");
    expect(capabilities.status).toBe(200);
    await expect(storage.getDevice(device.deviceId)).resolves.toMatchObject({
      id: device.deviceId,
      revokedAt: null,
    });
  });
});

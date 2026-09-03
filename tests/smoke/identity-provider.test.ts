import { describe, expect, it } from "vitest";
import { FakeIdentityProvider } from "../fakes/identityProvider";

/**
 * Phase 5 ticket #106: IdentityProvider port (ADR-0007, ADR-0017).
 * Seams: the port and its test fake. Clerk types stay inside the adapter.
 * Characterization of `/api/auth/*` stays away.
 */

/** Independent known-good: bcrypt of `password123` at cost 4. */
const PASSWORD = "password123";
const BCRYPT_HASH =
  "$2b$04$CJHjh937SDvS7hh3rhGtDeDrY0sTbWMloGRi22XPxY7Zb9scpnnj2";

const IMPORT = {
  email: "ada@example.com",
  passwordHash: BCRYPT_HASH,
};

describe("IdentityProvider fake", () => {
  it("imports a User by bcrypt hash so that password authenticates without a reset", async () => {
    const provider = new FakeIdentityProvider();

    const imported = await provider.importPasswordUser(IMPORT);

    expect(imported).toEqual({
      providerSubjectId: "user_fake_1",
      email: "ada@example.com",
    });
    await expect(provider.authenticate("ada@example.com", PASSWORD)).resolves.toEqual(
      imported
    );
    expect(JSON.stringify(IMPORT)).not.toMatch(/clerk/i);
  });

  it("does not import an OIDC-only User as a password User", async () => {
    const { IdentityProviderImportError } = await import(
      "../../server/modules/identity/identityProvider"
    );
    const provider = new FakeIdentityProvider();

    await expect(
      provider.importPasswordUser({
        email: "oidc@example.com",
        passwordHash: "REPLIT_OIDC_USER",
      })
    ).rejects.toBeInstanceOf(IdentityProviderImportError);
  });

  it("imports the same email once", async () => {
    const provider = new FakeIdentityProvider();

    const first = await provider.importPasswordUser(IMPORT);
    const second = await provider.importPasswordUser(IMPORT);

    expect(second).toEqual(first);
    expect(provider.imports).toHaveLength(2);
  });

  it("maps a session token to the imported provider subject", async () => {
    const provider = new FakeIdentityProvider();
    const imported = await provider.importPasswordUser(IMPORT);
    const token = provider.issueSessionToken(imported.providerSubjectId);

    await expect(provider.verifySessionToken(token)).resolves.toEqual({
      providerSubjectId: "user_fake_1",
      email: "ada@example.com",
    });
  });

  it("invites an address to set a password, and a second invite is the first one", async () => {
    const provider = new FakeIdentityProvider();

    const first = await provider.sendPasswordSetInvite({ email: "oidc@example.com" });
    const second = await provider.sendPasswordSetInvite({ email: "oidc@example.com" });

    expect(first).toEqual({
      email: "oidc@example.com",
      inviteId: "inv_fake_1",
      alreadyPending: false,
    });
    expect(second).toEqual({ ...first, alreadyPending: true });
    await expect(provider.pendingPasswordSetInvites()).resolves.toEqual(["oidc@example.com"]);
  });
});

describe("IdentityProvider without live credentials", () => {
  it("fails closed on import", async () => {
    const { IdentityProviderClosedError, createIdentityProvider } = await import(
      "../../server/modules/identity"
    );

    const provider = createIdentityProvider({ secretKey: undefined });

    await expect(provider.importPasswordUser(IMPORT)).rejects.toBeInstanceOf(
      IdentityProviderClosedError
    );
  });

  it("fails closed on the process IdentityProvider when credentials are absent", async () => {
    const { IdentityProviderClosedError, identityProvider } = await import(
      "../../server/modules/identity"
    );

    await expect(identityProvider.authenticate("ada@example.com", PASSWORD)).rejects.toBeInstanceOf(
      IdentityProviderClosedError
    );
  });

  it("fails closed on a password-set invite rather than reporting one sent", async () => {
    const { IdentityProviderClosedError, createIdentityProvider } = await import(
      "../../server/modules/identity"
    );

    const provider = createIdentityProvider({ secretKey: undefined });

    await expect(
      provider.sendPasswordSetInvite({ email: "oidc@example.com" })
    ).rejects.toBeInstanceOf(IdentityProviderClosedError);
    await expect(provider.pendingPasswordSetInvites()).rejects.toBeInstanceOf(
      IdentityProviderClosedError
    );
  });
});

describe("Clerk adapter", () => {
  it("imports by bcrypt digest, not a plaintext password, and authenticates without a reset", async () => {
    const { createIdentityProvider } = await import("../../server/modules/identity");
    const { clerkCreateUserCalls, resetClerk } = await import("../fakes/clerk");
    resetClerk();

    const provider = createIdentityProvider({ secretKey: "sk_test_fake" });
    const imported = await provider.importPasswordUser(IMPORT);

    expect(imported.email).toBe("ada@example.com");
    expect(imported.providerSubjectId).toBe("user_test_1");
    expect(clerkCreateUserCalls()).toEqual([
      {
        emailAddress: ["ada@example.com"],
        passwordDigest: BCRYPT_HASH,
        passwordHasher: "bcrypt",
      },
    ]);
    await expect(provider.authenticate("ada@example.com", PASSWORD)).resolves.toEqual(imported);
  });

  it("does not call Clerk when the hash is not usable", async () => {
    const { IdentityProviderImportError, createIdentityProvider } = await import(
      "../../server/modules/identity"
    );
    const { clerkCreateUserCalls, resetClerk } = await import("../fakes/clerk");
    resetClerk();

    const provider = createIdentityProvider({ secretKey: "sk_test_fake" });

    await expect(
      provider.importPasswordUser({
        email: "oidc@example.com",
        passwordHash: "REPLIT_OIDC_USER",
      })
    ).rejects.toBeInstanceOf(IdentityProviderImportError);
    expect(clerkCreateUserCalls()).toEqual([]);
  });

  it("maps a session token to the imported provider subject", async () => {
    const { createIdentityProvider } = await import("../../server/modules/identity");
    const { issueClerkSession, resetClerk } = await import("../fakes/clerk");
    resetClerk();

    const provider = createIdentityProvider({ secretKey: "sk_test_fake" });
    const imported = await provider.importPasswordUser(IMPORT);
    const token = issueClerkSession(imported.providerSubjectId);

    await expect(provider.verifySessionToken(token)).resolves.toEqual({
      providerSubjectId: "user_test_1",
      email: "ada@example.com",
    });
  });

  it("sends one password-set invitation per address and reports the outstanding one on a re-run", async () => {
    const { createIdentityProvider } = await import("../../server/modules/identity");
    const { clerkCreateInvitationCalls, resetClerk } = await import("../fakes/clerk");
    resetClerk();

    const provider = createIdentityProvider({ secretKey: "sk_test_fake" });
    const first = await provider.sendPasswordSetInvite({ email: "oidc@example.com" });
    const second = await provider.sendPasswordSetInvite({ email: "oidc@example.com" });

    expect(first.alreadyPending).toBe(false);
    expect(second).toEqual({ ...first, alreadyPending: true });
    expect(clerkCreateInvitationCalls()).toEqual([{ emailAddress: "oidc@example.com" }]);
    await expect(provider.pendingPasswordSetInvites()).resolves.toEqual(["oidc@example.com"]);
  });
});

describe("Clerk SDK import", () => {
  it("is confined to the IdentityProvider adapter", async () => {
    const { readdir, readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");

    async function walk(dir: string): Promise<string[]> {
      const entries = await readdir(dir, { withFileTypes: true });
      const files: string[] = [];
      for (const entry of entries) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) files.push(...(await walk(path)));
        else if (entry.name.endsWith(".ts")) files.push(path);
      }
      return files;
    }

    const files = await walk("server");
    const importers: string[] = [];
    for (const file of files) {
      const source = await readFile(file, "utf8");
      if (/(from|import)\s+["']@clerk\/backend["']/.test(source)) importers.push(file);
    }

    expect(importers).toEqual(["server/modules/identity/clerkAdapter.ts"]);
  });
});

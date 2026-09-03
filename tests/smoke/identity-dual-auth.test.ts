import { beforeEach, describe, expect, it } from "vitest";

/**
 * Phase 5 ticket #109: the dual-auth drain (ADR-0007, ADR-0017).
 *
 * Two seams. The first is `server/modules/identity/dualAuth.ts` — a provider
 * session token resolved to the `users.id` the import linked it to, proven
 * against the port fake. The second is HTTP: a provider session must reach the
 * same Membership, and the bearer paths that already carry a token of their
 * own must not be read as one.
 *
 * #110 retired the drain's legacy half and #111 removed the flag, so this
 * suite no longer has a rollback surface to flip. What stays true is how a
 * provider session resolves.
 *
 * Live Clerk is never reached. `vitest.config.ts` aliases `@clerk/backend` to
 * `tests/fakes/clerk.ts`, and the credentials named below are that fake's.
 */

// Before any server module loads: `server/config.ts` resolves Clerk credentials
// at import, and the process IdentityProvider is built from them. Without a key
// it fails closed, which is the harness default and the wrong subject here.
process.env.CLERK_SECRET_KEY = "sk_test_dual-auth-drain";
process.env.CLERK_PUBLISHABLE_KEY = "pk_test_dual-auth-drain";

import { makeApp } from "../helpers/app";
import { resetDb } from "../helpers/db";
import { newAgent, registerUser, uniqueEmail } from "../helpers/auth";
import { FakeIdentityProvider } from "../fakes/identityProvider";

beforeEach(async () => {
  await resetDb();
});

describe("dual-auth session resolution (#109)", () => {
  it("resolves a provider session to the User the import linked it to", async () => {
    const { userIdFromIdentitySession } = await import(
      "../../server/modules/identity/dualAuth"
    );
    const provider = new FakeIdentityProvider();
    const identity = await provider.importPasswordUser({
      email: "ada@example.com",
      passwordHash: "$2b$04$CJHjh937SDvS7hh3rhGtDeDrY0sTbWMloGRi22XPxY7Zb9scpnnj2",
    });
    const persistence = {
      async getUserByIdentityProviderSubjectId(subjectId: string) {
        return subjectId === identity.providerSubjectId ? { id: "user-1" } : undefined;
      },
    };

    const userId = await userIdFromIdentitySession({
      provider,
      persistence,
      token: provider.issueSessionToken(identity.providerSubjectId),
    });

    expect(userId).toBe("user-1");
  });

  it("resolves nobody for an unverifiable token, an unlinked subject, or a closed provider", async () => {
    const { userIdFromIdentitySession } = await import(
      "../../server/modules/identity/dualAuth"
    );
    const { createIdentityProvider } = await import("../../server/modules/identity");
    const provider = new FakeIdentityProvider();
    const identity = await provider.importPasswordUser({
      email: "ada@example.com",
      passwordHash: "$2b$04$CJHjh937SDvS7hh3rhGtDeDrY0sTbWMloGRi22XPxY7Zb9scpnnj2",
    });
    const linksNobody = { async getUserByIdentityProviderSubjectId() { return undefined; } };

    await expect(
      userIdFromIdentitySession({ provider, persistence: linksNobody, token: "sess_nonsense" })
    ).resolves.toBeUndefined();
    await expect(
      userIdFromIdentitySession({
        provider,
        persistence: linksNobody,
        token: provider.issueSessionToken(identity.providerSubjectId),
      })
    ).resolves.toBeUndefined();
    await expect(
      userIdFromIdentitySession({
        provider: createIdentityProvider({ secretKey: undefined }),
        persistence: linksNobody,
        token: "sess_anything",
      })
    ).resolves.toBeUndefined();
  });

  it("leaves the bearer paths that already carry a token of their own alone", async () => {
    const { isDrainablePath } = await import("../../server/modules/identity/dualAuth");

    expect(isDrainablePath("/api/agent/timer/start")).toBe(false);
    expect(isDrainablePath("/api/v1/projects")).toBe(false);
    expect(isDrainablePath("/api/projects")).toBe(true);
    expect(isDrainablePath("/api/auth/user")).toBe(true);
    // Not a prefix match on the string: a route that merely starts with the
    // same letters is still drained.
    expect(isDrainablePath("/api/agents")).toBe(true);

    // The three exceptions inside `/api/agent`: the web's own Device management,
    // guarded by `isAuthenticated` and reached from the browser. Skipping these
    // is what would leave a signed-in User unable to revoke their own Device.
    expect(isDrainablePath("/api/agent/devices")).toBe(true);
    expect(isDrainablePath("/api/agent/device/revoke")).toBe(true);
    expect(isDrainablePath("/api/agent/devices/revoke-machine")).toBe(true);
    // Exact matches only — a Device-token route under the same text is not one.
    expect(isDrainablePath("/api/agent/devices/anything-else")).toBe(false);
  });

  it("names every session-guarded route under the agent prefix", async () => {
    const { WEB_SESSION_AGENT_PATHS } = await import(
      "../../server/modules/identity/dualAuth"
    );
    const { readFileSync } = await import("node:fs");

    // Derived from the source rather than restated: a fourth `isAuthenticated`
    // route added under `/api/agent/` would otherwise be unreachable from the
    // browser, and nothing but a bug report would say so.
    const source = readFileSync("server/agentRoutes.ts", "utf8");
    const sessionGuarded = [
      ...source.matchAll(/app\.\w+\("(\/api\/agent\/[^"]+)",\s*isAuthenticated\b/g),
    ].map((match) => match[1]);

    expect(sessionGuarded.length).toBeGreaterThan(0);
    expect([...WEB_SESSION_AGENT_PATHS].sort()).toEqual(sessionGuarded.sort());
  });

  it("reads only a well-formed bearer credential", async () => {
    const { bearerToken } = await import("../../server/modules/identity/dualAuth");

    expect(bearerToken("Bearer sess_abc")).toBe("sess_abc");
    expect(bearerToken("Bearer   sess_abc  ")).toBe("sess_abc");
    expect(bearerToken("Bearer ")).toBeUndefined();
    expect(bearerToken("Basic sess_abc")).toBeUndefined();
    expect(bearerToken(undefined)).toBeUndefined();
  });
});

/**
 * Link a registered User to the provider through the real #108 import, then hand
 * back a session token for the subject it came back with — the same two steps a
 * drain performs, rather than a hand-written row.
 */
async function importAndIssueSession(userId: string): Promise<string> {
  const { storage } = await import("../../server/storage");
  const { identityProvider, importUsersIntoIdentityProvider } = await import(
    "../../server/modules/identity"
  );
  const { issueClerkSession } = await import("../fakes/clerk");

  const report = await importUsersIntoIdentityProvider({
    persistence: storage,
    provider: identityProvider,
  });
  const linked = report.outcomes.find((outcome) => outcome.userId === userId);
  if (!linked?.providerSubjectId) {
    throw new Error(`import did not link ${userId}: ${JSON.stringify(linked)}`);
  }
  return issueClerkSession(linked.providerSubjectId);
}

describe("dual-auth drain over HTTP (#109)", () => {
  it("lets a session the real import linked into the Workspace as that User", async () => {
    const app = await makeApp();
    const user = await registerUser(app, { email: uniqueEmail("drain") });
    // Not the token the helper already holds: this one comes back through
    // `importUsersIntoIdentityProvider`, so the #108 link is what is proven.
    const token = await importAndIssueSession(user.id);

    const mapped = await newAgent(app)
      .get("/api/auth/user")
      .set("Authorization", `Bearer ${token}`);

    expect(mapped.status).toBe(200);
    expect(mapped.body.id).toBe(user.id);

    // And the Membership behind it: a Workspace-scoped read succeeds, which it
    // cannot without a WorkspaceContext.
    const projects = await newAgent(app)
      .get("/api/projects")
      .set("Authorization", `Bearer ${token}`);
    expect(projects.status).toBe(200);
    expect(Array.isArray(projects.body)).toBe(true);
  });

  it("no longer has a legacy half: email/password is retired", async () => {
    const app = await makeApp();
    const email = uniqueEmail("drain-password");
    const user = await registerUser(app, { email });

    // #109 froze this as a 200: during the drain the User's own password still
    // worked. #110 answered 410; #111 deleted the stubs.
    const login = await newAgent(app).post("/api/auth/login").send({ email, password: user.password });

    expect(login.status).toBe(404);
  });

  it("refuses a provider session for a subject no User is linked to", async () => {
    const app = await makeApp();
    const { issueClerkSession } = await import("../fakes/clerk");

    const res = await newAgent(app)
      .get("/api/projects")
      .set("Authorization", `Bearer ${issueClerkSession("user_never_imported")}`);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ message: "Unauthorized" });
  });

  it("does not read the desktop agent's bearer token as a provider session", async () => {
    const app = await makeApp();

    const res = await newAgent(app)
      .get("/api/agent/timer/active")
      .set("Authorization", "Bearer not-a-provider-session");

    // The agent's own middleware answers, in its own words — the drain never
    // saw the header.
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ message: "Invalid access token" });
  });
});

/**
 * An OIDC-only User, built the way `identity-user-import` builds one: `upsertUser`
 * is the Replit OIDC callback's own write, and it leaves the `REPLIT_OIDC_USER`
 * placeholder on `users.password` rather than a hash.
 */
async function registerOidcOnlyUser(id: string): Promise<{ id: string; email: string }> {
  const { storage } = await import("../../server/storage");
  const email = uniqueEmail(id);
  const user = await storage.upsertUser({ id, email, firstName: "Odette" });
  return { id: user.id, email };
}

describe("password-set invites for OIDC-only Users (#109)", () => {
  it("invites the Users with no usable hash and leaves password Users alone", async () => {
    const { sendPasswordSetInvites } = await import("../../server/modules/identity");
    const app = await makeApp();
    const password = await registerUser(app, { email: uniqueEmail("password") });
    const oidc = await registerOidcOnlyUser("oidc-subject-1");
    const { storage } = await import("../../server/storage");
    const provider = new FakeIdentityProvider();

    const report = await sendPasswordSetInvites({ persistence: storage, provider });

    expect(provider.invites.map((invite) => invite.email)).toEqual([oidc.email]);
    expect(report.counts).toEqual({ invited: 1, alreadyInvited: 0, accepted: 0, failed: 0 });
    expect(report.remainingToInvite).toBe(0);
    expect(report.outcomes).toEqual([
      { userId: oidc.id, email: oidc.email, status: "invited", inviteId: "inv_fake_1" },
    ]);
    expect(report.outcomes.map((outcome) => outcome.email)).not.toContain(password.email);
    // The password User keeps the password they registered with: no invite, and
    // nothing written to their row.
    const untouched = await storage.getUserWithPassword(password.id);
    expect(untouched?.password).toMatch(/^\$2[aby]\$/);
  });

  it("re-running invites nobody a second time", async () => {
    const { sendPasswordSetInvites } = await import("../../server/modules/identity");
    const oidc = await registerOidcOnlyUser("oidc-subject-2");
    const { storage } = await import("../../server/storage");
    const provider = new FakeIdentityProvider();

    await sendPasswordSetInvites({ persistence: storage, provider });
    const second = await sendPasswordSetInvites({ persistence: storage, provider });

    expect(second.counts).toEqual({ invited: 0, alreadyInvited: 1, accepted: 0, failed: 0 });
    expect(second.remainingToInvite).toBe(0);
    await expect(provider.pendingPasswordSetInvites()).resolves.toEqual([oidc.email]);
  });

  it("links an invitee who has set their password, and stops asking about them", async () => {
    const { sendPasswordSetInvites } = await import("../../server/modules/identity");
    const oidc = await registerOidcOnlyUser("oidc-subject-3");
    const { storage } = await import("../../server/storage");
    const provider = new FakeIdentityProvider();
    await sendPasswordSetInvites({ persistence: storage, provider });

    const subject = provider.acceptPasswordSetInvite(oidc.email);
    const after = await sendPasswordSetInvites({ persistence: storage, provider });

    expect(after.counts).toEqual({ invited: 0, alreadyInvited: 0, accepted: 1, failed: 0 });
    expect(after.outcomes).toEqual([
      { userId: oidc.id, email: oidc.email, status: "accepted", providerSubjectId: subject },
    ]);
    // The link is what stops the verifier staying red once invites are answered:
    // an accepted invitee is no longer owed one, and no third run mails them.
    expect((await storage.getUserWithPassword(oidc.id))?.identityProviderSubjectId).toBe(subject);
    expect(after.remainingToInvite).toBe(0);
    const third = await sendPasswordSetInvites({ persistence: storage, provider });
    expect(third.outcomes).toEqual([]);
    expect(provider.invites).toHaveLength(1);
  });

  it("names the addresses it could not invite and leaves them outstanding", async () => {
    const { sendPasswordSetInvites } = await import("../../server/modules/identity");
    const oidc = await registerOidcOnlyUser("oidc-subject-4");
    const { storage } = await import("../../server/storage");
    const provider = new FakeIdentityProvider();
    provider.sendPasswordSetInvite = async () => {
      throw new Error("provider said no");
    };

    const report = await sendPasswordSetInvites({ persistence: storage, provider });

    expect(report.counts).toEqual({ invited: 0, alreadyInvited: 0, accepted: 0, failed: 1 });
    expect(report.outcomes).toEqual([
      { userId: oidc.id, email: oidc.email, status: "failed", detail: "provider said no" },
    ]);
    // The verifier re-reads rather than tallying: nobody was invited, so one
    // address is still owed one.
    expect(report.remainingToInvite).toBe(1);
  });

  it("stops on absent provider credentials rather than reporting every address failed", async () => {
    const { sendPasswordSetInvites, IdentityProviderClosedError, createIdentityProvider } =
      await import("../../server/modules/identity");
    await registerOidcOnlyUser("oidc-subject-5");
    const { storage } = await import("../../server/storage");

    await expect(
      sendPasswordSetInvites({
        persistence: storage,
        provider: createIdentityProvider({ secretKey: undefined }),
      })
    ).rejects.toBeInstanceOf(IdentityProviderClosedError);
  });
});

describe("identity:invite:password-set output", () => {
  it("lists the addresses owed an invite and names the ones that failed", async () => {
    const { formatPlan, formatReport } = await import(
      "../../scripts/identity-password-set-invites"
    );

    const plan = formatPlan([{ email: "oidc@example.com" }]);

    expect(plan).toContain("Password-set invites owed: 1");
    expect(plan).toContain("oidc@example.com");

    const report = formatReport({
      outcomes: [
        { userId: "bad-1", email: "bad@example.com", status: "failed", detail: "Clerk said no" },
      ],
      counts: { invited: 0, alreadyInvited: 0, accepted: 0, failed: 1 },
      remainingToInvite: 1,
    });

    expect(report).toContain("failed:               1");
    expect(report).toContain("bad@example.com\tClerk said no");
  });

  it("plans without reaching the provider", async () => {
    const { planPasswordSetInvites } = await import("../../server/modules/identity");
    const app = await makeApp();
    const password = await registerUser(app, { email: uniqueEmail("plan-password") });
    const oidc = await registerOidcOnlyUser("oidc-subject-6");
    const { storage } = await import("../../server/storage");

    await expect(planPasswordSetInvites(storage)).resolves.toEqual([
      { userId: oidc.id, email: oidc.email },
    ]);
    expect(password.email).not.toBe(oidc.email);
  });
});

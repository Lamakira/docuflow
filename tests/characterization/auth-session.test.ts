import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeApp } from "../helpers/app";
import { resetDb } from "../helpers/db";
import { login, newAgent, promoteToAdmin, registerUser, uniqueEmail } from "../helpers/auth";

/**
 * Characterization: web auth and the session contract, as of Clerk-only web
 * auth (#111). Password sign-in is gone and an IdentityProvider session is what
 * a browser presents; what is frozen here is what the server does with it.
 *
 * Quirks frozen here:
 *  - `POST /api/auth/login` and `POST /api/auth/register` are unmounted (#111)
 *    and answer Express's 404. They no longer distinguish a known address from
 *    an unknown one.
 *  - `GET /api/auth/user` answers 200 with a JSON `null` body when nobody is
 *    signed in, and does the same when the session names a deleted user — the
 *    SPA treats "no user" and "unknown user" identically.
 *  - It returns the whole user row minus `password`, which still carries
 *    `lastGeneratedPassword` (an admin-only field) and every internal flag.
 *  - `POST /api/auth/logout` destroys the legacy cookie session, which a Clerk
 *    sign-in never created. It answers 200 and the provider session it could not
 *    reach still works — ending that one is Clerk's job, and the SPA calls it.
 *  - The strict brute-force limiter is still mounted on `/api/login` and
 *    `/api/register` — the retired Replit OIDC paths, which now answer 410 —
 *    not on the `/api/auth/*` endpoints, which no longer have credentials to
 *    brute-force.
 *  - `X-API-Key` is ignored. It used to impersonate the Owner when it matched
 *    `MCP_API_KEY`; that header is gone.
 *  - Any error inside `GET /api/auth/user` is swallowed into a `null` body.
 *  - There is no self-service password change. The only route that sets
 *    `users.password` after creation is the admin-only
 *    `POST /api/admin/users/:id/reset-password` (frozen in `users-admin`), and
 *    that password now only opens the desktop agent, not the web.
 */
describe("auth and session (characterization)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("answers 404 to password sign-in and registration whatever the payload is", async () => {
    const app = await makeApp();
    const user = await registerUser(app);
    const anonymous = newAgent(app);

    const payloads = [
      { email: user.email, password: user.password },
      { email: uniqueEmail("nobody"), password: "password123" },
      { email: user.email, password: "not-the-password" },
      { email: "not-an-email" },
      {},
    ];

    for (const payload of payloads) {
      for (const path of ["/api/auth/login", "/api/auth/register"]) {
        const res = await anonymous.post(path).send(payload);
        expect(res.status, `${path} ${JSON.stringify(payload)}`).toBe(404);
      }
    }

    // And none of them minted anything on the way past.
    expect((await anonymous.get("/api/auth/user")).body).toBeNull();
  });

  it("returns the full row minus the password hash for the signed-in user", async () => {
    const app = await makeApp();
    const user = await registerUser(app, { firstName: "Ada", lastName: "Lovelace" });

    const res = await user.agent.get("/api/auth/user");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: user.id,
      email: user.email,
      firstName: "Ada",
      lastName: "Lovelace",
      role: "user",
      isMainAdmin: 0,
      canViewDailyUpdates: 0,
      hoursPerDay: 8,
      isArchived: false,
      profileImageUrl: null,
    });
    expect(res.body).not.toHaveProperty("password");
    // Quirk: the admin-only "last generated password" column ships to every
    // caller because the route strips `password` and nothing else.
    expect(res.body).toHaveProperty("lastGeneratedPassword", null);
  });

  it("keeps the provider session across requests and records the last login", async () => {
    const app = await makeApp();
    const user = await registerUser(app, { firstName: "Grace" });

    // Clerk owns the sign-in, so the first request of a session is what stamps
    // `lastLoginAt` — the retired login route was its only other writer.
    const me = await user.agent.get("/api/auth/user");
    expect(me.status).toBe(200);
    expect(typeof me.body.lastLoginAt).toBe("string");

    // A second browser on the same User is a second provider session, and the
    // first one is untouched by it.
    const second = await login(app, user.email);
    expect((await second.get("/api/auth/user")).body.id).toBe(user.id);
    expect((await user.agent.get("/api/projects")).status).toBe(200);
  });

  it("logs out of a session it never had, and the provider session survives", async () => {
    const app = await makeApp();
    const user = await registerUser(app);

    const first = await user.agent.post("/api/auth/logout");
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ message: "Logged out successfully" });

    // Quirk: destroying an already-destroyed session is not an error — the route
    // answers 200 for a caller that was never signed in.
    const second = await user.agent.post("/api/auth/logout");
    expect(second.status).toBe(200);

    // And the quirk that matters after #110: this route only ever reached the
    // cookie session. The provider session is still a way in, which is why the
    // SPA signs out through Clerk rather than through here.
    const after = await user.agent.get("/api/projects");
    expect(after.status).toBe(200);
  });

  it("answers null when the session names a user that no longer exists", async () => {
    const app = await makeApp();
    const admin = await registerUser(app);
    await promoteToAdmin(admin.id);
    const victim = await registerUser(app);

    const deleted = await admin.agent.delete(`/api/admin/users/${victim.id}`);
    expect(deleted.status).toBe(200);

    // The provider would still vouch for the subject, but the link it resolves
    // through is a DocuFlow row and that row is gone.
    const me = await victim.agent.get("/api/auth/user");
    expect(me.status).toBe(200);
    expect(me.body).toBeNull();

    const stillAuthorized = await victim.agent.get("/api/projects");
    expect(stillAuthorized.status).toBe(401);
  });

  it("guards protected routes but leaves the health check open", async () => {
    const app = await makeApp();
    const anonymous = newAgent(app);

    const health = await anonymous.get("/health");
    expect(health.status).toBe(200);
    expect(health.body.status).toBe("ok");
    expect(typeof health.body.timestamp).toBe("string");

    for (const path of ["/api/projects", "/api/users", "/api/notifications", "/api/tasks"]) {
      const res = await anonymous.get(path);
      expect(res.status, path).toBe(401);
      expect(res.body, path).toEqual({ message: "Unauthorized" });
    }

    const adminOnly = await anonymous.get("/api/admin/users");
    expect(adminOnly.status).toBe(401);
    // Quirk: admin routes stack two guards, and the outer one wins — the body is
    // the `isAuthenticated` message, not `isAdmin`'s "Not authenticated".
    expect(adminOnly.body).toEqual({ message: "Unauthorized" });
  });

  describe("MCP API key bypass is gone", () => {
    afterEach(() => {
      delete process.env.MCP_API_KEY;
    });

    it("does not impersonate the Owner when a leftover key matches", async () => {
      const app = await makeApp();
      const admin = await registerUser(app);
      await promoteToAdmin(admin.id);
      process.env.MCP_API_KEY = "test-mcp-key";

      const authorized = await newAgent(app)
        .get("/api/auth/user")
        .set("x-api-key", "test-mcp-key");
      expect(authorized.status).toBe(200);
      expect(authorized.body).toBeNull();

      const guarded = await newAgent(app)
        .get("/api/admin/users")
        .set("x-api-key", "test-mcp-key");
      expect(guarded.status).toBe(401);
      expect(guarded.body).toEqual({ message: "Unauthorized" });
    });
  });
});

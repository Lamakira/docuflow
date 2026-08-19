import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeApp } from "../helpers/app";
import { resetDb } from "../helpers/db";
import { login, newAgent, promoteToAdmin, registerUser, uniqueEmail } from "../helpers/auth";

/**
 * Characterization: legacy web auth and session contract.
 *
 * Quirks frozen here:
 *  - `GET /api/auth/user` answers 200 with a JSON `null` body when nobody is
 *    logged in, and does the same when the session points at a deleted user —
 *    the SPA treats "no user" and "unknown user" identically.
 *  - Registration and login return the whole user row minus `password`, which
 *    still carries `lastGeneratedPassword` (an admin-only field) and every
 *    internal flag.
 *  - The strict brute-force limiter is mounted on `/api/login` and
 *    `/api/register`, not on the `/api/auth/*` endpoints the SPA actually posts
 *    to, so real logins are only covered by the loose global limit.
 *  - Any error inside `GET /api/auth/user` is swallowed into a `null` body.
 *  - There is no self-service password change. The only route that sets a
 *    password after registration is the admin-only
 *    `POST /api/admin/users/:id/reset-password` (frozen in `users-admin`), so a
 *    user who knows their own password cannot rotate it. The absence is part of
 *    the contract a later phase has to decide about deliberately.
 */
describe("auth and session (characterization)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("registers a user and returns the full row minus the password hash", async () => {
    const app = await makeApp();
    const agent = newAgent(app);
    const email = uniqueEmail("register");

    const res = await agent
      .post("/api/auth/register")
      .send({ email, password: "password123", firstName: "Ada", lastName: "Lovelace" });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      email,
      firstName: "Ada",
      lastName: "Lovelace",
      role: "user",
      isMainAdmin: 0,
      canViewDailyUpdates: 0,
      hoursPerDay: 8,
      isArchived: false,
      profileImageUrl: null,
      lastLoginAt: null,
    });
    expect(res.body).not.toHaveProperty("password");
    // Quirk: the admin-only "last generated password" column ships to every
    // caller because the route strips `password` and nothing else.
    expect(res.body).toHaveProperty("lastGeneratedPassword", null);
    expect(typeof res.body.id).toBe("string");
  });

  it("validates the registration payload one message at a time", async () => {
    const app = await makeApp();
    const agent = newAgent(app);

    const badEmail = await agent
      .post("/api/auth/register")
      .send({ email: "not-an-email", password: "password123" });
    expect(badEmail.status).toBe(400);
    expect(badEmail.body).toEqual({ message: "Invalid email address" });

    const shortPassword = await agent
      .post("/api/auth/register")
      .send({ email: uniqueEmail("short"), password: "short" });
    expect(shortPassword.status).toBe(400);
    // Quirk: only the first Zod issue is reported, so a request that is wrong in
    // two ways still gets a single message.
    expect(shortPassword.body).toEqual({ message: "Password must be at least 8 characters" });
  });

  it("keeps the session across requests and records the last login", async () => {
    const app = await makeApp();
    const user = await registerUser(app, { firstName: "Grace" });

    const beforeLogin = await user.agent.get("/api/auth/user");
    expect(beforeLogin.status).toBe(200);
    expect(beforeLogin.body.lastLoginAt).toBeNull();

    const fresh = await login(app, user.email, user.password);
    const afterLogin = await fresh.get("/api/auth/user");
    expect(afterLogin.status).toBe(200);
    expect(afterLogin.body.id).toBe(user.id);
    expect(typeof afterLogin.body.lastLoginAt).toBe("string");

    // The registration session survives the second login on a separate cookie jar.
    const stillValid = await user.agent.get("/api/projects");
    expect(stillValid.status).toBe(200);
  });

  it("rejects unknown emails and wrong passwords with one message", async () => {
    const app = await makeApp();
    const user = await registerUser(app);
    const agent = newAgent(app);

    const unknown = await agent
      .post("/api/auth/login")
      .send({ email: uniqueEmail("nobody"), password: "password123" });
    expect(unknown.status).toBe(401);
    expect(unknown.body).toEqual({ message: "Invalid email or password" });

    const wrongPassword = await agent
      .post("/api/auth/login")
      .send({ email: user.email, password: "not-the-password" });
    expect(wrongPassword.status).toBe(401);
    expect(wrongPassword.body).toEqual({ message: "Invalid email or password" });

    const missingPassword = await agent.post("/api/auth/login").send({ email: user.email });
    expect(missingPassword.status).toBe(400);
    // Quirk: the schema's custom "Password is required" text only covers an empty
    // string. Omitting the field entirely surfaces Zod's default wording instead.
    expect(missingPassword.body).toEqual({ message: "Required" });

    const emptyPassword = await agent
      .post("/api/auth/login")
      .send({ email: user.email, password: "" });
    expect(emptyPassword.status).toBe(400);
    expect(emptyPassword.body).toEqual({ message: "Password is required" });
  });

  it("logs out, and logging out again still succeeds", async () => {
    const app = await makeApp();
    const user = await registerUser(app);

    const first = await user.agent.post("/api/auth/logout");
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ message: "Logged out successfully" });

    // Quirk: destroying an already-destroyed session is not an error — the route
    // answers 200 for a caller that was never logged in.
    const second = await user.agent.post("/api/auth/logout");
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ message: "Logged out successfully" });

    const after = await user.agent.get("/api/projects");
    expect(after.status).toBe(401);
    expect(after.body).toEqual({ message: "Unauthorized" });
  });

  it("answers null when the session points at a user that no longer exists", async () => {
    const app = await makeApp();
    const admin = await registerUser(app);
    await promoteToAdmin(admin.id);
    const victim = await registerUser(app);

    const deleted = await admin.agent.delete(`/api/admin/users/${victim.id}`);
    expect(deleted.status).toBe(200);

    // Identity is global: the session cookie is still valid, so /api/auth/user
    // looks the user up and answers null. Workspace routes fail closed.
    const me = await victim.agent.get("/api/auth/user");
    expect(me.status).toBe(200);
    expect(me.body).toBeNull();

    // The session cookie is still valid, but there is no Membership left to
    // enter a Workspace with (#95).
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

  describe("MCP API key bypass", () => {
    afterEach(() => {
      delete process.env.MCP_API_KEY;
    });

    it("authenticates as the main admin when the key matches", async () => {
      const app = await makeApp();
      const admin = await registerUser(app);
      await promoteToAdmin(admin.id);
      process.env.MCP_API_KEY = "test-mcp-key";

      const authorized = await newAgent(app)
        .get("/api/auth/user")
        .set("x-api-key", "test-mcp-key");
      expect(authorized.status).toBe(200);
      // Quirk: `/api/auth/user` has no `isAuthenticated` guard, so the key does
      // nothing here — the endpoint still reports nobody logged in.
      expect(authorized.body).toBeNull();

      const guarded = await newAgent(app)
        .get("/api/admin/users")
        .set("x-api-key", "test-mcp-key");
      expect(guarded.status).toBe(200);
      expect(Array.isArray(guarded.body)).toBe(true);

      const wrongKey = await newAgent(app)
        .get("/api/admin/users")
        .set("x-api-key", "wrong-key");
      expect(wrongKey.status).toBe(401);
    });

    it("falls through to 401 when no admin account exists", async () => {
      const app = await makeApp();
      await registerUser(app); // plain user — `getMainAdmin` finds nothing
      process.env.MCP_API_KEY = "test-mcp-key";

      const res = await newAgent(app)
        .get("/api/projects")
        .set("x-api-key", "test-mcp-key");
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ message: "Unauthorized" });
    });
  });
});

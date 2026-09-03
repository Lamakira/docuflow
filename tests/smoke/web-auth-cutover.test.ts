import { beforeEach, describe, expect, it } from "vitest";

/**
 * Phase 5 ticket #110: web auth cut over to Clerk (ADR-0007, ADR-0017).
 *
 * The drain (#109) added a second way in. This ticket takes the first one away:
 * DocuFlow no longer verifies a password or mints a session of its own for the
 * web, so an IdentityProvider session is the only thing that reaches a
 * Workspace through the browser. Authorization is untouched — the Membership
 * still decides what that User may do.
 *
 * #111 then deleted the 410 stubs this ticket left on `/api/auth/login` and
 * `/api/auth/register`, and removed the drain flag. What stays true here is the
 * cutover itself: password posts mint nothing, a provider session enters, and
 * `GET /api/auth/config` serves the publishable key.
 *
 * Live Clerk is never reached. `vitest.config.ts` aliases `@clerk/backend` to
 * `tests/fakes/clerk.ts`, and the credentials below are that fake's.
 */

process.env.CLERK_SECRET_KEY = "sk_test_web-auth-cutover";
process.env.CLERK_PUBLISHABLE_KEY = "pk_test_web-auth-cutover";

import { makeApp } from "../helpers/app";
import { resetDb } from "../helpers/db";
import { newAgent, registerUser, uniqueEmail } from "../helpers/auth";

beforeEach(async () => {
  await resetDb();
});

describe("password sign-in is retired (#110)", () => {
  it("answers 404 to a login with the User's real password and establishes no session", async () => {
    const app = await makeApp();
    const user = await registerUser(app, { email: uniqueEmail("retired-login") });
    const agent = newAgent(app);

    const login = await agent.post("/api/auth/login").send({
      email: user.email,
      password: user.password,
    });

    expect(login.status).toBe(404);
    // Nothing was minted: the same cookie jar is still nobody.
    await expect(agent.get("/api/auth/user").then((res) => res.body)).resolves.toBeNull();
    const denied = await agent.get("/api/projects");
    expect(denied.status).toBe(401);
    expect(denied.body).toEqual({ message: "Unauthorized" });
  });

  it("answers 404 to registration and creates no User", async () => {
    const app = await makeApp();
    const { storage } = await import("../../server/storage");
    const email = uniqueEmail("retired-register");

    const res = await newAgent(app)
      .post("/api/auth/register")
      .send({ email, password: "password123", firstName: "Ada" });

    expect(res.status).toBe(404);
    await expect(storage.getUserByEmail(email)).resolves.toBeUndefined();
  });
});

describe("web sign-in through Clerk (#110)", () => {
  it("enters the Workspace as the linked User, with the Membership deciding", async () => {
    const app = await makeApp();
    const user = await registerUser(app, { email: uniqueEmail("clerk-signin") });

    const me = await user.agent.get("/api/auth/user");
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ id: user.id, email: user.email });
    expect(me.body).not.toHaveProperty("password");

    // A Workspace-scoped read, which has no answer without a WorkspaceContext
    // built from this User's Membership.
    const projects = await user.agent.get("/api/projects");
    expect(projects.status).toBe(200);
    expect(Array.isArray(projects.body)).toBe(true);
  });

  it("stamps the last login on the first request, and not again within the hour", async () => {
    const app = await makeApp();
    const { storage } = await import("../../server/storage");
    const { createUnlinkedUser, signIn } = await import("../helpers/auth");

    // The retired login route was `lastLoginAt`'s only writer, so a User who has
    // made no request has never been stamped.
    const user = await createUnlinkedUser({ email: uniqueEmail("clerk-lastlogin") });
    expect((await storage.getUser(user.id))?.lastLoginAt).toBeNull();

    const agent = await signIn(app, user.id);
    const first = await agent.get("/api/auth/user");
    expect(typeof first.body.lastLoginAt).toBe("string");

    // The write is conditional on an hour having passed, so the next request —
    // and every other request this session makes — touches no row.
    const stamped = (await storage.getUser(user.id))?.lastLoginAt;
    await agent.get("/api/projects");
    expect((await storage.getUser(user.id))?.lastLoginAt).toEqual(stamped);
  });
});

describe("GET /api/auth/config (#110)", () => {
  it("serves the publishable key and says web sign-in is available", async () => {
    const app = await makeApp();

    const res = await newAgent(app).get("/api/auth/config");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      publishableKey: "pk_test_web-auth-cutover",
      enabled: true,
    });
  });

  it("never serves the secret key, and is readable before anyone signs in", async () => {
    const app = await makeApp();

    const res = await newAgent(app).get("/api/auth/config");

    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain("sk_test_");
  });

  it("answers the same question the boot line does", async () => {
    const app = await makeApp();
    const { webSignInAvailable } = await import("../../server/config");

    const res = await newAgent(app).get("/api/auth/config");
    expect(res.body.enabled).toBe(webSignInAvailable());
  });
});

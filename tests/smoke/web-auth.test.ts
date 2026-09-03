import { describe, it, expect, beforeEach } from "vitest";
import { makeApp } from "../helpers/app";
import { resetDb } from "../helpers/db";
import { login, newAgent, registerUser, uniqueEmail } from "../helpers/auth";

/**
 * Characterization smoke tests: freeze the CURRENT behavior of the web auth
 * contract, quirks included. These assert what the server does today, not what
 * it should do.
 *
 * Since #110 that contract is Clerk's: the browser presents an IdentityProvider
 * session and DocuFlow resolves it to the linked User. The cutover itself — the
 * retired password routes, the rollback surface, `/api/auth/config` — is proven
 * in `web-auth-cutover.test.ts`.
 */
describe("web auth (characterization smoke)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("serves the session user and answers null once nobody is signed in", async () => {
    const app = await makeApp();
    const user = await registerUser(app, { email: uniqueEmail("smoke"), firstName: "Smoke" });

    const me = await user.agent.get("/api/auth/user");
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ id: user.id, email: user.email, firstName: "Smoke" });
    // safeUser: password is stripped from the response
    expect(me.body).not.toHaveProperty("password");

    // Quirk: an unauthenticated /api/auth/user is 200 with a JSON null body, not 401.
    const anonymous = await newAgent(app).get("/api/auth/user");
    expect(anonymous.status).toBe(200);
    expect(anonymous.body).toBeNull();
  });

  it("lets the same User sign in twice, and refuses a session nobody is linked to", async () => {
    const app = await makeApp();
    const user = await registerUser(app, { email: uniqueEmail("smoke2") });
    const { issueClerkSession } = await import("../fakes/clerk");

    const second = await login(app, user.email);
    const authed = await second.get("/api/auth/user");
    expect(authed.status).toBe(200);
    expect(authed.body).toMatchObject({ id: user.id, email: user.email });

    // Fails closed: the provider vouches for the subject, but no User is linked
    // to it, so it is nobody here.
    const stranger = await newAgent(app)
      .get("/api/auth/user")
      .set("Authorization", `Bearer ${issueClerkSession("user_never_linked")}`);
    expect(stranger.body).toBeNull();
  });

  it("protected routes without a session are 401", async () => {
    const app = await makeApp();

    const denied = await newAgent(app).get("/api/projects");
    expect(denied.status).toBe(401);
    expect(denied.body).toEqual({ message: "Unauthorized" });

    // A bearer credential the provider will not verify is not a way in either.
    const garbage = await newAgent(app)
      .get("/api/projects")
      .set("Authorization", "Bearer not-a-session");
    expect(garbage.status).toBe(401);
    expect(garbage.body).toEqual({ message: "Unauthorized" });
  });
});

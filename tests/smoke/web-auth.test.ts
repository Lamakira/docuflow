import request from "supertest";
import { describe, it, expect, beforeEach } from "vitest";
import { makeApp } from "../helpers/app";
import { resetDb } from "../helpers/db";

/**
 * Characterization smoke tests: freeze the CURRENT behavior of the legacy web
 * auth contract, quirks included. These assert what the server does today,
 * not what it should do.
 */
describe("web auth (characterization smoke)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("registers a user, serves the session user, logs out", async () => {
    const app = await makeApp();
    const agent = request.agent(app);

    const reg = await agent.post("/api/auth/register").send({
      email: "smoke@example.com",
      password: "password123",
      firstName: "Smoke",
    });
    expect(reg.status).toBe(201);
    expect(reg.body).toMatchObject({ email: "smoke@example.com", firstName: "Smoke" });
    // safeUser: password is stripped from the response
    expect(reg.body).not.toHaveProperty("password");
    expect(typeof reg.body.id).toBe("string");

    const me = await agent.get("/api/auth/user");
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ id: reg.body.id, email: "smoke@example.com" });

    const out = await agent.post("/api/auth/logout");
    expect(out.status).toBe(200);
    expect(out.body).toEqual({ message: "Logged out successfully" });

    // Quirk: unauthenticated /api/auth/user is 200 with a JSON null body, not 401.
    const after = await agent.get("/api/auth/user");
    expect(after.status).toBe(200);
    expect(after.body).toBeNull();
  });

  it("logs in with valid credentials and rejects a bad password", async () => {
    const app = await makeApp();
    await request(app).post("/api/auth/register").send({
      email: "smoke2@example.com",
      password: "password123",
    });

    const agent = request.agent(app);
    const login = await agent.post("/api/auth/login").send({
      email: "smoke2@example.com",
      password: "password123",
    });
    expect(login.status).toBe(200);
    expect(login.body).toMatchObject({ email: "smoke2@example.com" });
    expect(login.body).not.toHaveProperty("password");

    const authed = await agent.get("/api/auth/user");
    expect(authed.status).toBe(200);
    expect(authed.body).toMatchObject({ email: "smoke2@example.com" });

    const bad = await request(app).post("/api/auth/login").send({
      email: "smoke2@example.com",
      password: "wrong-password",
    });
    expect(bad.status).toBe(401);
    expect(bad.body).toEqual({ message: "Invalid email or password" });
  });

  it("duplicate registration is rejected; protected route without session is 401", async () => {
    const app = await makeApp();
    await request(app).post("/api/auth/register").send({
      email: "smoke3@example.com",
      password: "password123",
    });

    const dup = await request(app).post("/api/auth/register").send({
      email: "smoke3@example.com",
      password: "password456",
    });
    expect(dup.status).toBe(400);
    expect(dup.body).toEqual({ message: "Email already registered" });

    const denied = await request(app).get("/api/projects");
    expect(denied.status).toBe(401);
    expect(denied.body).toEqual({ message: "Unauthorized" });
  });
});

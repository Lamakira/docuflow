import { randomUUID } from "crypto";
import request from "supertest";
import { describe, it, expect, beforeEach } from "vitest";
import type { Express } from "express";
import { makeApp } from "../helpers/app";
import { resetDb } from "../helpers/db";

/**
 * Characterization smoke tests over the desktop agent v1 protocol: freeze the
 * implementation's CURRENT wire behavior (which the protocol docs have
 * drifted from), quirks included.
 */
describe("desktop agent auth (characterization smoke)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  /**
   * The desktop agent still signs in with the email and password on `users`
   * (#105 leaves Devices on their own token path), so this suite needs a User
   * with a real hash — the web's own registration route is retired (#110).
   */
  async function registerUser(app: Express): Promise<void> {
    const { registerUser: create } = await import("../helpers/auth");
    await create(app, { email: "agent@example.com", password: "password123" });
  }

  it("ping reports email-password auth", async () => {
    const app = await makeApp();
    const res = await request(app).get("/api/agent/ping");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, server: "DocuFlow", agentAuth: "email-password-v1" });
  });

  it("logs a device in and refreshes its access token", async () => {
    const app = await makeApp();
    await registerUser(app);

    const login = await request(app).post("/api/agent/auth/login").send({
      email: "agent@example.com",
      password: "password123",
      deviceMeta: { deviceName: "Smoke Machine", os: "linux" },
    });
    expect(login.status).toBe(200);
    expect(typeof login.body.deviceId).toBe("string");
    expect(typeof login.body.deviceToken).toBe("string");
    expect(typeof login.body.accessToken).toBe("string");
    expect(new Date(login.body.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(login.body.user).toMatchObject({ email: "agent@example.com" });

    const refresh = await request(app).post("/api/agent/auth/refresh").send({
      deviceId: login.body.deviceId,
      deviceToken: login.body.deviceToken,
    });
    expect(refresh.status).toBe(200);
    expect(typeof refresh.body.accessToken).toBe("string");
    expect(new Date(refresh.body.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("rejects bad credentials and unknown device refresh", async () => {
    const app = await makeApp();
    await registerUser(app);

    const bad = await request(app).post("/api/agent/auth/login").send({
      email: "agent@example.com",
      password: "nope",
      deviceMeta: { deviceName: "X" },
    });
    expect(bad.status).toBe(401);
    expect(bad.body).toEqual({ message: "Invalid email or password" });

    const refresh = await request(app).post("/api/agent/auth/refresh").send({
      deviceId: randomUUID(),
      deviceToken: "bogus-token",
    });
    expect(refresh.status).toBe(401);
    expect(refresh.body).toEqual({ message: "Invalid device credentials" });
  });

  it("retired pairing endpoints return 410 Gone", async () => {
    const app = await makeApp();
    const res = await request(app).post("/api/agent/pairing/start").send({});
    expect(res.status).toBe(410);
    expect(res.body.message).toMatch(/Pairing codes have been removed/);
  });
});

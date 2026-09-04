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

  it("pairs a Device from a signed-in web session and refuses a used or expired code", async () => {
    const app = await makeApp();
    const { registerUser: create } = await import("../helpers/auth");
    const user = await create(app, { email: "agent@example.com", password: "password123" });

    const anonymous = await request(app).post("/api/agent/pairing/start").send({});
    expect(anonymous.status).toBe(401);

    const start = await user.agent.post("/api/agent/pairing/start").send({});
    expect(start.status).toBe(200);
    expect(typeof start.body.pairingCode).toBe("string");
    expect(new Date(start.body.expiresAt).getTime()).toBeGreaterThan(Date.now());

    const complete = await request(app).post("/api/agent/pairing/complete").send({
      pairingCode: start.body.pairingCode,
      deviceMeta: { deviceName: "Smoke Pair", os: "linux" },
    });
    expect(complete.status).toBe(200);
    expect(typeof complete.body.deviceId).toBe("string");
    expect(typeof complete.body.deviceToken).toBe("string");
    expect(typeof complete.body.accessToken).toBe("string");
    expect(new Date(complete.body.expiresAt).getTime()).toBeGreaterThan(Date.now());

    const reused = await request(app).post("/api/agent/pairing/complete").send({
      pairingCode: start.body.pairingCode,
      deviceMeta: { deviceName: "Smoke Pair Again" },
    });
    expect(reused.status).toBe(400);

    const unknown = await request(app).post("/api/agent/pairing/complete").send({
      pairingCode: "ZZZZZZ",
      deviceMeta: { deviceName: "Nobody" },
    });
    expect(unknown.status).toBe(400);

    const { expirePairingCode } = await import("../helpers/agent");
    const expiring = await user.agent.post("/api/agent/pairing/start").send({});
    await expirePairingCode(expiring.body.pairingCode);
    const expired = await request(app).post("/api/agent/pairing/complete").send({
      pairingCode: expiring.body.pairingCode,
      deviceMeta: { deviceName: "Late" },
    });
    expect(expired.status).toBe(400);

    const listed = await user.agent.get("/api/agent/devices");
    expect(listed.body.data).toHaveLength(1);
    expect(listed.body.data[0].id).toBe(complete.body.deviceId);
  });
});

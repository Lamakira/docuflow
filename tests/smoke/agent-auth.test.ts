import { randomUUID } from "crypto";
import { describe, it, expect, beforeEach } from "vitest";
import { expirePairingCode, loginDevice } from "../helpers/agent";
import { makeApp } from "../helpers/app";
import { newAgent, registerUser } from "../helpers/auth";
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

  it("ping reports pairing auth", async () => {
    const app = await makeApp();
    const res = await newAgent(app).get("/api/agent/ping");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, server: "DocuFlow", agentAuth: "pairing-v1" });
  });

  it("answers 410 on password login, whatever is posted", async () => {
    const app = await makeApp();
    const user = await registerUser(app, { email: "agent@example.com" });

    const withCredentials = await newAgent(app).post("/api/agent/auth/login").send({
      email: user.email,
      password: "password123",
      deviceMeta: { deviceName: "Smoke Machine", os: "linux" },
    });
    expect(withCredentials.status).toBe(410);
    expect(withCredentials.body).toEqual({
      message:
        "This sign-in path has moved to pairing. Pair a Device from a signed-in DocuFlow web session.",
    });

    const empty = await newAgent(app).post("/api/agent/auth/login").send({});
    expect(empty.status).toBe(410);
    expect(empty.body).toEqual(withCredentials.body);

    const listed = await user.agent.get("/api/agent/devices");
    expect(listed.body.data).toEqual([]);
  });

  it("refreshes an already paired Device and rejects unknown device credentials", async () => {
    const app = await makeApp();
    const user = await registerUser(app, { email: "agent@example.com" });
    const device = await loginDevice(app, user, { deviceName: "Smoke Machine", os: "linux" });

    const refresh = await newAgent(app).post("/api/agent/auth/refresh").send({
      deviceId: device.deviceId,
      deviceToken: device.deviceToken,
    });
    expect(refresh.status).toBe(200);
    expect(typeof refresh.body.accessToken).toBe("string");
    expect(new Date(refresh.body.expiresAt).getTime()).toBeGreaterThan(Date.now());

    const unknown = await newAgent(app).post("/api/agent/auth/refresh").send({
      deviceId: randomUUID(),
      deviceToken: "bogus-token",
    });
    expect(unknown.status).toBe(401);
    expect(unknown.body).toEqual({ message: "Invalid device credentials" });
  });

  it("pairs a Device from a signed-in web session and refuses a used or expired code", async () => {
    const app = await makeApp();
    const user = await registerUser(app, { email: "agent@example.com" });

    const anonymous = await newAgent(app).post("/api/agent/pairing/start").send({});
    expect(anonymous.status).toBe(401);

    const start = await user.agent.post("/api/agent/pairing/start").send({});
    expect(start.status).toBe(200);
    expect(typeof start.body.pairingCode).toBe("string");
    expect(new Date(start.body.expiresAt).getTime()).toBeGreaterThan(Date.now());

    const complete = await newAgent(app).post("/api/agent/pairing/complete").send({
      pairingCode: start.body.pairingCode,
      deviceMeta: { deviceName: "Smoke Pair", os: "linux" },
    });
    expect(complete.status).toBe(200);
    expect(typeof complete.body.deviceId).toBe("string");
    expect(typeof complete.body.deviceToken).toBe("string");
    expect(typeof complete.body.accessToken).toBe("string");
    expect(new Date(complete.body.expiresAt).getTime()).toBeGreaterThan(Date.now());

    const reused = await newAgent(app).post("/api/agent/pairing/complete").send({
      pairingCode: start.body.pairingCode,
      deviceMeta: { deviceName: "Smoke Pair Again" },
    });
    expect(reused.status).toBe(400);

    const unknown = await newAgent(app).post("/api/agent/pairing/complete").send({
      pairingCode: "ZZZZZZ",
      deviceMeta: { deviceName: "Nobody" },
    });
    expect(unknown.status).toBe(400);

    const expiring = await user.agent.post("/api/agent/pairing/start").send({});
    await expirePairingCode(expiring.body.pairingCode);
    const expired = await newAgent(app).post("/api/agent/pairing/complete").send({
      pairingCode: expiring.body.pairingCode,
      deviceMeta: { deviceName: "Late" },
    });
    expect(expired.status).toBe(400);

    const listed = await user.agent.get("/api/agent/devices");
    expect(listed.body.data).toHaveLength(1);
    expect(listed.body.data[0].id).toBe(complete.body.deviceId);
  });
});

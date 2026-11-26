import { describe, it, expect, beforeEach } from "vitest";
import { makeApp } from "../helpers/app";
import { resetDb } from "../helpers/db";
import { newAgent, registerUser, setWorkspaceRole } from "../helpers/auth";
import { loginDevice } from "../helpers/agent";
import { inSeededWorkspace } from "../helpers/workspace";

/**
 * The Devices review's server findings (docs/web-app-v2/UI-FINDINGS.md):
 *  - F113: the listing sends only what the screen shows, never the token hash.
 *  - F114: a new pairing code replaces the person's unused ones, and failed
 *    completes are held per address.
 *  - F118: a Read-only Workspace still lets a Member revoke a Device.
 */

const PAIRING_LIMIT_MESSAGE = "Too many pairing attempts. Wait a few minutes, then try a new code.";

describe("Devices review: server (F113, F114, F118)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("lists each Device with exactly the six fields the screen reads", async () => {
    const app = await makeApp();
    const user = await registerUser(app);
    await loginDevice(app, user, { deviceName: "Laptop" });

    const res = await user.agent.get("/api/agent/devices");
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(Object.keys(res.body.data[0]).sort()).toEqual(
      ["clientVersion", "id", "lastSeenAt", "name", "os", "revokedAt"].sort()
    );
    expect(res.body.data[0]).not.toHaveProperty("deviceTokenHash");
  });

  it("retires an unused code when a new one is minted: only the newest enrolls", async () => {
    const app = await makeApp();
    const user = await registerUser(app);

    const first = await user.agent.post("/api/agent/pairing/start").send({});
    const second = await user.agent.post("/api/agent/pairing/start").send({});
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const stale = await newAgent(app)
      .post("/api/agent/pairing/complete")
      .send({ pairingCode: first.body.pairingCode, deviceMeta: { deviceName: "Stale" } });
    expect(stale.status).toBe(400);
    expect(stale.body).toEqual({ message: "Pairing code expired" });

    const fresh = await newAgent(app)
      .post("/api/agent/pairing/complete")
      .send({ pairingCode: second.body.pairingCode, deviceMeta: { deviceName: "Fresh" } });
    expect(fresh.status).toBe(200);

    const devices = await user.agent.get("/api/agent/devices");
    expect(devices.body.data.map((d: { name: string }) => d.name)).toEqual(["Fresh"]);
  });

  it("holds an address after ten failed completes, and a code that enrolls is not counted", async () => {
    const app = await makeApp();
    const user = await registerUser(app);
    // `trust proxy` is 1, so the forwarded address is the one the limiter keys
    // on: this suite's failures stay off the address every other test uses.
    const address = "203.0.113.7";
    const attempt = (pairingCode: string) =>
      newAgent(app)
        .post("/api/agent/pairing/complete")
        .set("X-Forwarded-For", address)
        .send({ pairingCode, deviceMeta: { deviceName: "Guess" } });

    for (let i = 0; i < 9; i++) {
      const res = await attempt("ZZZZZZ");
      expect(res.status).toBe(400);
    }

    const start = await user.agent.post("/api/agent/pairing/start").send({});
    const enrolled = await attempt(start.body.pairingCode);
    expect(enrolled.status).toBe(200);

    const tenth = await attempt("ZZZZZZ");
    expect(tenth.status).toBe(400);
    expect(tenth.body).toEqual({ message: "Invalid pairing code" });

    const eleventh = await attempt("ZZZZZZ");
    expect(eleventh.status).toBe(429);
    expect(eleventh.body).toEqual({ message: PAIRING_LIMIT_MESSAGE });
  });

  it("lets a Read-only Workspace revoke a machine or a Device, and still refuses a new pairing code", async () => {
    const app = await makeApp();
    const { markPastDue, exhaustDunning } = await import("../../server/modules/billing");
    const user = await registerUser(app);
    await setWorkspaceRole(user.id, "owner");
    const device = await loginDevice(app, user, { deviceName: "Lost laptop", os: "linux" });
    const desktop = await loginDevice(app, user, { deviceName: "Stolen desktop", os: "win32" });
    await inSeededWorkspace(async () => {
      await markPastDue({ kind: "system" });
      await exhaustDunning({ kind: "system" });
    });

    const pairing = await user.agent.post("/api/agent/pairing/start").send({});
    expect(pairing.status).toBe(403);
    expect(pairing.body).toEqual({ message: "Workspace is read-only" });

    const revoked = await user.agent
      .post("/api/agent/devices/revoke-machine")
      .send({ name: "Lost laptop", os: "linux" });
    expect(revoked.status).toBe(200);
    expect(revoked.body).toEqual({ ok: true });

    const single = await user.agent.post("/api/agent/device/revoke").send({ deviceId: desktop.deviceId });
    expect(single.status).toBe(200);

    const devices = await user.agent.get("/api/agent/devices");
    for (const id of [device.deviceId, desktop.deviceId]) {
      const row = devices.body.data.find((d: { id: string }) => d.id === id);
      expect(typeof row.revokedAt).toBe("string");
    }
  });
});

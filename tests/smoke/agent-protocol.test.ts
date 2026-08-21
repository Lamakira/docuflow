import { randomUUID } from "crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { bearer, loginDevice, PNG_1X1 } from "../helpers/agent";
import { makeApp } from "../helpers/app";
import { registerUser } from "../helpers/auth";
import { resetDb } from "../helpers/db";
import { createCrmProject, createTask } from "../helpers/fixtures";

/**
 * Phase 7 ticket #128: desktop `/api/agent/*` is protocol v1. Handshake and
 * heartbeat carry clock anchor, Tracking Policy version, minimum protocol
 * version, and directives. Fields are additive. A below-minimum agent is
 * refused for new work and still accepted on the drain path.
 */

const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

describe("desktop agent protocol v1", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("returns handshake fields on login and heartbeat without changing existing payloads", async () => {
    const app = await makeApp();
    const user = await registerUser(app);

    const login = await user.agent.post("/api/agent/auth/login").send({
      email: user.email,
      password: user.password,
      deviceMeta: { deviceName: "Protocol Workstation", os: "linux" },
    });
    expect(login.status).toBe(200);
    expect(typeof login.body.deviceId).toBe("string");
    expect(typeof login.body.deviceToken).toBe("string");
    expect(typeof login.body.accessToken).toBe("string");
    expect(login.body.clockAnchor).toMatch(RFC3339);
    expect(login.body.trackingPolicyVersion).toBe(1);
    expect(login.body.minProtocolVersion).toBe(1);
    expect(login.body.directives).toEqual([]);

    const heartbeat = await bearer(app, login.body.accessToken)
      .post("/api/agent/heartbeat")
      .send({
        deviceId: login.body.deviceId,
        timestamp: new Date().toISOString(),
        clientType: "desktop",
        clientVersion: "0.1.0",
      });
    expect(heartbeat.status).toBe(200);
    expect(heartbeat.body.ok).toBe(true);
    expect(heartbeat.body.serverTime).toMatch(RFC3339);
    expect(heartbeat.body.timerSync).toBeNull();
    expect(heartbeat.body.screenshotPolicy).toMatchObject({ screenshotsEnabled: true });
    expect(heartbeat.body.clockAnchor).toBe(heartbeat.body.serverTime);
    expect(heartbeat.body.trackingPolicyVersion).toBe(1);
    expect(heartbeat.body.minProtocolVersion).toBe(1);
    expect(heartbeat.body.directives).toEqual([]);
  });

  it("refuses below-minimum new work and still accepts the drain path", async () => {
    const app = await makeApp();
    const user = await registerUser(app);
    const device = await loginDevice(app, user);
    const { crmProject } = await createCrmProject(user.agent);
    const task = await createTask(user.agent, crmProject.id);
    const belowMin = { "X-Agent-Protocol-Version": "0" };
    const heartbeatBody = {
      deviceId: device.deviceId,
      timestamp: new Date().toISOString(),
      clientType: "desktop",
      clientVersion: "0.1.0",
    };

    const currentHeartbeat = await device.request.post("/api/agent/heartbeat").send(heartbeatBody);
    expect(currentHeartbeat.status).toBe(200);

    const currentStart = await device.request
      .post("/api/agent/timer/start")
      .send({ crmProjectId: crmProject.id, taskId: task.id });
    expect(currentStart.status).toBe(200);
    await device.request.post(`/api/agent/timer/${currentStart.body.id}/stop`);

    const refusedHeartbeat = await device.request
      .post("/api/agent/heartbeat")
      .set(belowMin)
      .send(heartbeatBody);
    expect(refusedHeartbeat.status).toBe(403);
    expect(refusedHeartbeat.body).toEqual({
      code: "protocol_below_minimum",
      message: "Agent protocol is below the minimum supported version",
      minProtocolVersion: 1,
    });

    const refusedProjects = await device.request.get("/api/agent/projects").set(belowMin);
    expect(refusedProjects.status).toBe(403);
    expect(refusedProjects.body.code).toBe("protocol_below_minimum");

    const invalidHeader = await device.request
      .post("/api/agent/heartbeat")
      .set({ "X-Agent-Protocol-Version": "nope" })
      .send(heartbeatBody);
    expect(invalidHeader.status).toBe(400);
    expect(invalidHeader.body).toEqual({ message: "Invalid request" });

    const drainStart = await device.request
      .post("/api/agent/timer/start")
      .set(belowMin)
      .send({ crmProjectId: crmProject.id, taskId: task.id, clientCommandId: randomUUID() });
    expect(drainStart.status).toBe(200);
    expect(typeof drainStart.body.id).toBe("string");

    const drainBatch = await device.request
      .post("/api/agent/events/batch")
      .set(belowMin)
      .send({
        deviceId: device.deviceId,
        batchId: randomUUID(),
        clientType: "desktop",
        clientVersion: "0.1.0",
        events: [{ type: "input_activity", timestamp: new Date().toISOString(), data: { keyCount: 1 } }],
      });
    expect(drainBatch.status).toBe(200);
    expect(drainBatch.body).toMatchObject({ ok: true, accepted: 1 });

    const slot = await device.request
      .post("/api/agent/screenshots/presign")
      .set(belowMin)
      .send({
        deviceId: device.deviceId,
        timeEntryId: drainStart.body.id,
        capturedAt: new Date().toISOString(),
        clientType: "desktop",
        clientVersion: "0.1.0",
      });
    expect(slot.status).toBe(200);

    const drainUpload = await device.request
      .put(slot.body.uploadURL)
      .set(belowMin)
      .set("Content-Type", "image/png")
      .send(PNG_1X1);
    expect(drainUpload.status).toBe(200);

    const drainConfirm = await device.request
      .post("/api/agent/screenshots/confirm")
      .set(belowMin)
      .send({ screenshotId: slot.body.screenshotId, deviceId: device.deviceId });
    expect(drainConfirm.status).toBe(200);
    expect(drainConfirm.body).toEqual({ ok: true });

    const drainPause = await device.request
      .post(`/api/agent/timer/${drainStart.body.id}/pause`)
      .set(belowMin);
    expect(drainPause.status).toBe(200);
  });
});

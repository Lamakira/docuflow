import { randomUUID } from "crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loginDevice, PNG_1X1, type AgentDevice } from "../helpers/agent";
import { makeApp } from "../helpers/app";
import { registerAdmin, type TestUser } from "../helpers/auth";
import { ownerDb, resetDb } from "../helpers/db";
import { createCrmProject, createTask } from "../helpers/fixtures";

/**
 * #400, ADR-0031: Simultaneous Timers over HTTP — `/api/time-tracking/*` for
 * the web, `/api/agent/*` for the desktop agent. The one-Timer contract with
 * the option off stays frozen in time-tracking.test.ts and
 * timer-counts-once.test.ts.
 */

const LAUNCH_ENV = "SIMULTANEOUS_TIMERS_LAUNCH_AT";
const V2 = { "X-Agent-Protocol-Version": "2" };

async function trackable(user: TestUser) {
  const { crmProject: atlas } = await createCrmProject(user.agent, { status: "won_in_progress", name: "Atlas" });
  const { crmProject: borealis } = await createCrmProject(user.agent, { status: "won_in_progress", name: "Borealis" });
  const ledger = await createTask(user.agent, atlas.id, "Ledger");
  const map = await createTask(user.agent, borealis.id, "Map");
  return { atlas: atlas.id, borealis: borealis.id, ledger: ledger.id, map: map.id };
}

async function turnOn(admin: TestUser) {
  const res = await admin.agent.patch("/api/admin/org-settings").send({ screenshotPolicy: { simultaneousTimersEnabled: true } });
  expect(res.status).toBe(200);
}

function heartbeatBody(device: AgentDevice, extra: Record<string, unknown> = {}) {
  return {
    deviceId: device.deviceId,
    timestamp: new Date().toISOString(),
    clientType: "desktop",
    clientVersion: "0.2.9",
    ...extra,
  };
}

describe("Simultaneous Timers over HTTP (#400)", () => {
  beforeEach(async () => {
    await resetDb();
    process.env[LAUNCH_ENV] = "2026-01-01T00:00:00.000Z";
  });

  afterEach(() => {
    delete process.env[LAUNCH_ENV];
  });

  it("refuses to turn the option on before the launch, and lets an Administrator turn it on after", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);

    process.env[LAUNCH_ENV] = "2099-01-01T00:00:00.000Z";
    const early = await admin.agent.patch("/api/admin/org-settings").send({ screenshotPolicy: { simultaneousTimersEnabled: true } });
    expect(early.status).toBe(409);
    expect(early.body.code).toBe("simultaneous_timers_not_launched");
    const settings = await admin.agent.get("/api/admin/org-settings");
    expect(settings.body.simultaneousTimers).toEqual({
      launched: false,
      launchAt: "2099-01-01T00:00:00.000Z",
      includedInPlan: true,
    });
    expect((await admin.agent.get("/api/time-tracking/capabilities")).body).toEqual({ requiresTask: true });

    process.env[LAUNCH_ENV] = "2026-01-01T00:00:00.000Z";
    await turnOn(admin);
    expect((await admin.agent.get("/api/time-tracking/capabilities")).body).toEqual({
      requiresTask: true,
      simultaneousTimers: true,
      maxTimers: 3,
    });
    const policy = await admin.agent.get("/api/time-tracking/tracking-policy");
    expect(policy.body.screenshotPolicy.simultaneousTimersEnabled).toBe(true);
  });

  it("adds a Timer on the web, refuses a second on the same Task, lists both and stops them all", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);
    await turnOn(admin);
    const w = await trackable(admin);

    expect((await admin.agent.post("/api/time-tracking/start").send({ crmProjectId: w.atlas, taskId: w.ledger })).status).toBe(200);
    const added = await admin.agent.post("/api/time-tracking/start").send({ crmProjectId: w.borealis, taskId: w.map, mode: "add" });
    expect(added.status).toBe(200);

    const twice = await admin.agent.post("/api/time-tracking/start").send({ crmProjectId: w.atlas, taskId: w.ledger, mode: "add" });
    expect(twice.status).toBe(409);
    expect(twice.body).toEqual({ code: "task_has_timer", message: "A Timer already runs on this Task." });
    const badMode = await admin.agent.post("/api/time-tracking/start").send({ crmProjectId: w.atlas, taskId: w.ledger, mode: "both" });
    expect(badMode.status).toBe(400);

    const timers = await admin.agent.get("/api/time-tracking/timers");
    expect(timers.body.data.map((t: { taskId: string }) => t.taskId)).toEqual([w.map, w.ledger]);
    // The names come with the Timers, so the chip's list loads nothing of its own.
    expect(timers.body.data.map((t: { projectName: string; taskName: string }) => [t.projectName, t.taskName])).toEqual([
      ["Borealis", "Map"],
      ["Atlas", "Ledger"],
    ]);
    expect((await admin.agent.get("/api/time-tracking/active")).body.id).toBe(added.body.id);

    const stopped = await admin.agent.post("/api/time-tracking/stop-all");
    expect(stopped.status).toBe(200);
    expect(stopped.body.data).toHaveLength(2);
    expect((await admin.agent.get("/api/time-tracking/timers")).body.data).toEqual([]);
  });

  it("refuses to add while the option is off, and Start still switches", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);
    const w = await trackable(admin);
    await admin.agent.post("/api/time-tracking/start").send({ crmProjectId: w.atlas, taskId: w.ledger });

    const added = await admin.agent.post("/api/time-tracking/start").send({ crmProjectId: w.borealis, taskId: w.map, mode: "add" });
    expect(added.status).toBe(409);
    expect(added.body.code).toBe("simultaneous_timers_off");
    const switched = await admin.agent.post("/api/time-tracking/start").send({ crmProjectId: w.borealis, taskId: w.map, mode: "switch" });
    expect(switched.status).toBe(200);
    expect((await admin.agent.get("/api/time-tracking/timers")).body.data).toHaveLength(1);
  });

  it("starts, beats and resyncs every Timer of a v2 agent", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);
    await turnOn(admin);
    const w = await trackable(admin);
    const device = await loginDevice(app, admin);

    const a = await device.request.post("/api/agent/timer/start").set(V2).send({ crmProjectId: w.atlas, taskId: w.ledger });
    const b = await device.request.post("/api/agent/timer/start").set(V2).send({ crmProjectId: w.borealis, taskId: w.map, mode: "add" });
    expect([a.status, b.status]).toEqual([200, 200]);
    const limit = await device.request
      .post("/api/agent/timer/start")
      .set(V2)
      .send({ crmProjectId: w.borealis, taskId: w.map, mode: "add" });
    expect(limit.status).toBe(409);

    const beat = await device.request
      .post("/api/agent/heartbeat")
      .set(V2)
      .send(heartbeatBody(device, { timeEntryIds: [a.body.id, b.body.id] }));
    expect(beat.status).toBe(200);
    expect(beat.body.timers.map((t: { entryId: string }) => t.entryId)).toEqual([b.body.id, a.body.id]);
    expect(beat.body.timerSync.entryId).toBe(b.body.id);
    expect(beat.body.screenshotPolicy.simultaneousTimersEnabled).toBe(true);
    const listed = await device.request.get("/api/agent/timers").set(V2);
    expect(listed.body.data).toHaveLength(2);

    const { devices } = await import("../../shared/schema");
    const { eq } = await import("drizzle-orm");
    const [row] = await ownerDb.select().from(devices).where(eq(devices.id, device.deviceId));
    expect([row.agentProtocolVersion, row.clientVersion]).toEqual([2, "0.2.9"]);

    const worked = await device.request.get("/api/agent/worked-today").set(V2).query({ includeActive: "1" });
    expect(worked.status).toBe(200);
    expect(worked.body).toEqual({ total: expect.any(Number), simultaneous: expect.any(Number) });
  });

  it("refuses start to an agent that declares no version after the launch, and lets its pause, stop and queued data pass", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);
    const w = await trackable(admin);
    const device = await loginDevice(app, admin);

    process.env[LAUNCH_ENV] = "2099-01-01T00:00:00.000Z";
    const before = await device.request.post("/api/agent/timer/start").send({ crmProjectId: w.atlas, taskId: w.ledger });
    expect(before.status).toBe(200);

    process.env[LAUNCH_ENV] = "2026-01-01T00:00:00.000Z";
    for (const headers of [{}, { "X-Agent-Protocol-Version": "1" }]) {
      const refused = await device.request
        .post("/api/agent/timer/start")
        .set(headers)
        .send({ crmProjectId: w.borealis, taskId: w.map, clientCommandId: randomUUID() });
      expect(refused.status).toBe(403);
      expect(refused.body).toEqual({
        code: "protocol_below_minimum",
        message: "Agent protocol is below the minimum supported version",
        minProtocolVersion: 2,
      });
    }
    const heartbeat = await device.request.post("/api/agent/heartbeat").send(heartbeatBody(device));
    expect(heartbeat.status).toBe(403);

    const batch = await device.request.post("/api/agent/events/batch").send({
      deviceId: device.deviceId,
      batchId: randomUUID(),
      clientType: "desktop",
      clientVersion: "0.2.8",
      events: [{ type: "input_activity", timestamp: new Date().toISOString(), data: { keyCount: 1 } }],
    });
    expect(batch.status).toBe(200);
    expect((await device.request.post(`/api/agent/timer/${before.body.id}/pause`)).status).toBe(200);
    expect((await device.request.post(`/api/agent/timer/${before.body.id}/stop`)).status).toBe(200);
  });

  it("attaches one capture to every running Timer: it shows in both Projects and counts once", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);
    await turnOn(admin);
    const w = await trackable(admin);
    const device = await loginDevice(app, admin);

    const a = await device.request.post("/api/agent/timer/start").set(V2).send({ crmProjectId: w.atlas, taskId: w.ledger });
    await device.request.post("/api/agent/timer/start").set(V2).send({ crmProjectId: w.borealis, taskId: w.map, mode: "add" });

    const slot = await device.request.post("/api/agent/screenshots/presign").set(V2).send({
      deviceId: device.deviceId,
      timeEntryId: a.body.id,
      capturedAt: new Date().toISOString(),
      clientType: "desktop",
      clientVersion: "0.2.9",
    });
    expect(slot.status).toBe(200);
    expect((await device.request.put(slot.body.uploadURL).set(V2).set("Content-Type", "image/png").send(PNG_1X1)).status).toBe(200);
    expect(
      (await device.request.post("/api/agent/screenshots/confirm").set(V2).send({ screenshotId: slot.body.screenshotId, deviceId: device.deviceId })).status,
    ).toBe(200);

    for (const crmProjectId of [w.atlas, w.borealis]) {
      const listed = await admin.agent.get("/api/time-tracking/screenshots").query({ crmProjectId });
      expect(listed.status).toBe(200);
      expect(listed.body.data.map((row: { id: string }) => row.id), crmProjectId).toEqual([slot.body.screenshotId]);
    }
    const everything = await admin.agent.get("/api/time-tracking/screenshots");
    expect(everything.body.total).toBe(1);
    const stats = await admin.agent.get("/api/time-tracking/stats").query({ includeActive: "1" });
    expect(stats.body.screenshotCount).toBe(1);
  });

  it("warns a Member whose Device still runs an older desktop app, in the app and by the operator's script", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);
    const device = await loginDevice(app, admin, { deviceName: "Studio laptop" });

    delete process.env[LAUNCH_ENV];
    expect((await admin.agent.get("/api/time-tracking/agent-update")).body).toEqual({ launchAt: null, launched: false, devices: [] });

    process.env[LAUNCH_ENV] = "2099-01-01T00:00:00.000Z";
    // An agent before 0.2.8 declares nothing.
    expect((await device.request.post("/api/agent/heartbeat").send(heartbeatBody(device, { clientVersion: "0.2.7" }))).status).toBe(200);
    const warned = await admin.agent.get("/api/time-tracking/agent-update");
    expect(warned.body).toEqual({
      launchAt: "2099-01-01T00:00:00.000Z",
      launched: false,
      devices: [{ id: device.deviceId, name: "Studio laptop", clientVersion: "0.2.7" }],
    });
    const { warnOutdatedAgents } = await import("../../scripts/warn-outdated-agents");
    const dryRun = await warnOutdatedAgents();
    expect(dryRun).toEqual({ members: 1, sent: 0, failed: [] });

    await device.request.post("/api/agent/heartbeat").set(V2).send(heartbeatBody(device));
    expect((await admin.agent.get("/api/time-tracking/agent-update")).body.devices).toEqual([]);
    expect((await warnOutdatedAgents()).members).toBe(0);
  });
});


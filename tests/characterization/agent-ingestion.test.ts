import { randomUUID } from "crypto";
import { describe, it, expect, beforeEach } from "vitest";
import { makeApp } from "../helpers/app";
import { resetDb } from "../helpers/db";
import { registerAdmin, registerUser, type TestUser } from "../helpers/auth";
import { createCrmProject, createTask, startTimer } from "../helpers/fixtures";
import { loginDevice, type AgentDevice } from "../helpers/agent";

/**
 * Characterization: what the desktop agent sends up — heartbeats and activity
 * event batches — and what the server sends back down with them.
 *
 * Divergences from `docs/agent-protocol.md`, all frozen below:
 *
 *  - §4.2 documents the heartbeat reply as `{ ok, serverTime }`. It also carries
 *    `timerSync` (the server's authoritative timer state) and `screenshotPolicy`
 *    (the org capture settings), which is how policy reaches the agent at all —
 *    the document describes no policy delivery.
 *  - §4.2/§5 present `activeApp` and `activeWindow` as the heartbeat's payload.
 *    Both are accepted, validated, and then discarded; only `active_window`
 *    *events* are stored.
 *  - §5 lists a `heartbeat` event type "via dedicated endpoint". The endpoint
 *    exists; the event type is not in the accepted enum.
 *  - §6 says events with no active entry are stored with `timeEntryId: null` and
 *    "backend may associate later via user + time window". Nothing associates
 *    later — the entry is stamped once, at ingest.
 *  - §4.2 says processed `batchId`s are kept for 7 days. Nothing prunes them, so
 *    idempotency is permanent.
 *  - §6 describes the agent's own SQLite queue; that is client-side and cannot be
 *    seen at this seam.
 *
 * Behavior quirks frozen here:
 *  - Heartbeat trusts `deviceId` from the *body*, not from the token — the one
 *    agent route that does — so a device can report for another user's device.
 *  - Heartbeat trusts the client's `timestamp` for duration accrual and does not
 *    check the entry belongs to the caller.
 *  - Nothing auto-stops a stale timer; the gap is credited as worked time on the
 *    next heartbeat, and taken back again when the entry stops.
 *  - `batchId` is globally unique, not per-device, so one device's replay silences
 *    another's genuine batch.
 */
describe("desktop agent ingestion (characterization)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  async function trackingUser(app: Awaited<ReturnType<typeof makeApp>>) {
    const user = await registerUser(app);
    const device = await loginDevice(app, user);
    const { crmProject } = await createCrmProject(user.agent);
    const task = await createTask(user.agent, crmProject.id);
    return { user, device, crmProjectId: crmProject.id, taskId: task.id };
  }

  function heartbeat(device: AgentDevice, body: Record<string, unknown> = {}) {
    return device.request.post("/api/agent/heartbeat").send({
      deviceId: device.deviceId,
      timestamp: new Date().toISOString(),
      clientType: "desktop",
      clientVersion: "0.1.0",
      ...body,
    });
  }

  function batch(device: AgentDevice, body: Record<string, unknown> = {}) {
    return device.request.post("/api/agent/events/batch").send({
      deviceId: device.deviceId,
      batchId: randomUUID(),
      clientType: "desktop",
      clientVersion: "0.1.0",
      events: [{ type: "input_activity", timestamp: new Date().toISOString(), data: { keyCount: 42 } }],
      ...body,
    });
  }

  // ─── Heartbeat ───

  it("answers a heartbeat with the server clock, the timer state, and the capture policy", async () => {
    const app = await makeApp();
    const { user, device, crmProjectId, taskId } = await trackingUser(app);

    const idle = await heartbeat(device);
    expect(idle.status).toBe(200);
    expect(idle.body.ok).toBe(true);
    expect(idle.body.serverTime).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // No entry running: the desktop is told there is nothing to sync to.
    expect(idle.body.timerSync).toBeNull();
    // The policy rides on every heartbeat, whether or not anything is tracked.
    expect(idle.body.screenshotPolicy).toEqual({
      screenshotsEnabled: true,
      captureIntervalMinMin: 3,
      captureIntervalMaxMin: 5,
      activeHoursEnabled: false,
      activeHoursStart: "08:00",
      activeHoursEnd: "18:00",
      idlePromptEnabled: true,
      idleTimeoutMinutes: 10,
      idleCountdownSeconds: 60,
    });

    const entry = await startTimer(user.agent, crmProjectId, taskId);
    const running = await heartbeat(device, { timeEntryId: entry.id });
    expect(running.body.timerSync).toMatchObject({
      entryId: entry.id,
      status: "running",
      taskId,
    });
    expect(typeof running.body.timerSync.projectName).toBe("string");
    expect(typeof running.body.timerSync.taskName).toBe("string");
    expect(running.body.timerSync.startTime).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // A paused entry is still the entry to sync to; only a stop clears it.
    await user.agent.post(`/api/time-tracking/${entry.id}/pause`);
    const paused = await heartbeat(device, { timeEntryId: entry.id });
    expect(paused.body.timerSync).toMatchObject({ entryId: entry.id, status: "paused" });

    await user.agent.post(`/api/time-tracking/${entry.id}/stop`);
    const stopped = await heartbeat(device, { timeEntryId: entry.id });
    expect(stopped.body.timerSync).toBeNull();
  });

  it("hands the agent whatever capture policy the admin last saved", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);
    const { device } = await trackingUser(app);

    const updated = await admin.agent.patch("/api/admin/org-settings").send({
      screenshotPolicy: {
        screenshotsEnabled: false,
        captureIntervalMinMin: 4,
        captureIntervalMaxMin: 12,
        idleTimeoutMinutes: 25,
      },
    });
    expect(updated.status).toBe(200);

    const res = await heartbeat(device);
    expect(res.body.screenshotPolicy).toMatchObject({
      screenshotsEnabled: false,
      captureIntervalMinMin: 4,
      captureIntervalMaxMin: 12,
      idleTimeoutMinutes: 25,
      // Unsent keys keep their defaults — the policy is merged, not replaced.
      idleCountdownSeconds: 60,
      activeHoursStart: "08:00",
    });
  });

  it("credits the gap between heartbeats to the running entry, on the client's clock", async () => {
    const app = await makeApp();
    const { user, device, crmProjectId, taskId } = await trackingUser(app);
    const entry = await startTimer(user.agent, crmProjectId, taskId);

    // Quirk: `timestamp` is taken at face value, so the client decides how much
    // time accrued. Nothing bounds it against the server clock.
    const ahead = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const res = await heartbeat(device, { timeEntryId: entry.id, timestamp: ahead });
    expect(res.status).toBe(200);

    const afterFirst = await user.agent.get("/api/time-tracking/active");
    expect(afterFirst.body.duration).toBeGreaterThanOrEqual(300);
    expect(afterFirst.body.duration).toBeLessThan(310);

    // Accrual is measured from `lastActivityAt`, which the previous heartbeat
    // moved, so a second beat at the same instant adds nothing.
    await heartbeat(device, { timeEntryId: entry.id, timestamp: ahead });
    const afterSecond = await user.agent.get("/api/time-tracking/active");
    expect(afterSecond.body.duration).toBe(afterFirst.body.duration);

    // Quirk: a timestamp older than `lastActivityAt` would compute a negative
    // gap; it is floored at 0, but `lastActivityAt` still moves backwards.
    const behind = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    await heartbeat(device, { timeEntryId: entry.id, timestamp: behind });
    const afterBackdated = await user.agent.get("/api/time-tracking/active");
    expect(afterBackdated.body.duration).toBe(afterFirst.body.duration);
  });

  it("never auto-stops a timer the agent stopped heartbeating for", async () => {
    const app = await makeApp();
    const { user, device, crmProjectId, taskId } = await trackingUser(app);
    const entry = await startTimer(user.agent, crmProjectId, taskId);

    // The server's stale-session job is flag_only: it logs and moves on. An
    // agent that crashes leaves the entry running, and the whole silent stretch
    // is credited the moment it comes back — the resolution deferred by the
    // `TODO [PLACEHOLDER]` on the auto-stop branch in `server/routes.ts`.
    const muchLater = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
    await heartbeat(device, { timeEntryId: entry.id, timestamp: muchLater });

    const active = await user.agent.get("/api/time-tracking/active");
    expect(active.body).toMatchObject({ id: entry.id, status: "running" });
    expect(active.body.duration).toBeGreaterThanOrEqual(8 * 60 * 60);

    // The inflation is only visible while the entry runs: stopping adds
    // `now - lastActivityAt`, which is negative by exactly what the heartbeat
    // added, so the stored total collapses back to real elapsed time.
    const stopped = await user.agent.post(`/api/time-tracking/${entry.id}/stop`);
    expect(stopped.status).toBe(200);
    expect(stopped.body.duration).toBeLessThan(60);
  });

  it("leaves a paused entry's clock alone", async () => {
    const app = await makeApp();
    const { user, device, crmProjectId, taskId } = await trackingUser(app);
    const entry = await startTimer(user.agent, crmProjectId, taskId);
    await user.agent.post(`/api/time-tracking/${entry.id}/pause`);

    const paused = await user.agent.get("/api/time-tracking/active");
    const durationWhilePaused = paused.body.duration;

    await heartbeat(device, {
      timeEntryId: entry.id,
      timestamp: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });

    const after = await user.agent.get("/api/time-tracking/active");
    expect(after.body.duration).toBe(durationWhilePaused);
    expect(after.body.status).toBe("paused");
  });

  it("accrues time on any running entry it is pointed at, including someone else's", async () => {
    const app = await makeApp();
    const owner = await registerUser(app);
    const { crmProject } = await createCrmProject(owner.agent);
    const task = await createTask(owner.agent, crmProject.id);
    const foreignEntry = await startTimer(owner.agent, crmProject.id, task.id);

    const outsider = await trackingUser(app);

    // Quirk: the entry is fetched by id and checked only for `status`, never for
    // ownership, so a stranger's heartbeat inflates the owner's tracked time.
    const res = await heartbeat(outsider.device, {
      timeEntryId: foreignEntry.id,
      timestamp: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    });
    expect(res.status).toBe(200);
    // `timerSync` still describes the *caller's* own timer, which is nothing.
    expect(res.body.timerSync).toBeNull();

    const victim = await owner.agent.get("/api/time-tracking/active");
    expect(victim.body.duration).toBeGreaterThanOrEqual(300);

    const unknownEntry = await heartbeat(outsider.device, { timeEntryId: randomUUID() });
    expect(unknownEntry.status).toBe(200);
  });

  it("checks the body's device for revocation, not the token's", async () => {
    const app = await makeApp();
    const user = await registerUser(app);
    const stranger = await registerUser(app);
    const device = await loginDevice(app, user);
    const strangersDevice = await loginDevice(app, stranger);

    const beforeBeat = await stranger.agent.get("/api/agent/devices");
    const lastSeenBefore = beforeBeat.body.data[0].lastSeenAt;

    // Quirk: the body's `deviceId` is used for the revocation check and for the
    // lastSeenAt stamp, so one user's agent can mark another user's device as
    // recently seen. Every other agent route reads the device off the token.
    const res = await device.request.post("/api/agent/heartbeat").send({
      deviceId: strangersDevice.deviceId,
      timestamp: new Date().toISOString(),
      clientType: "desktop",
      clientVersion: "0.1.0",
    });
    expect(res.status).toBe(200);

    const afterBeat = await stranger.agent.get("/api/agent/devices");
    expect(new Date(afterBeat.body.data[0].lastSeenAt).getTime()).toBeGreaterThan(
      new Date(lastSeenBefore).getTime()
    );

    // The mirror image: a healthy caller naming a revoked device is refused,
    // even though its own device is fine.
    await stranger.agent
      .post("/api/agent/device/revoke")
      .send({ deviceId: strangersDevice.deviceId });
    const refused = await device.request.post("/api/agent/heartbeat").send({
      deviceId: strangersDevice.deviceId,
      timestamp: new Date().toISOString(),
      clientType: "desktop",
      clientVersion: "0.1.0",
    });
    expect(refused.status).toBe(403);
    expect(refused.body).toEqual({ code: "device_revoked", message: "Device has been revoked" });

    // Its own heartbeat still works.
    expect((await heartbeat(device)).status).toBe(200);
  });

  it("validates the heartbeat body and requires a bearer token", async () => {
    const app = await makeApp();
    const { device } = await trackingUser(app);

    const anonymous = await registerUser(app).then((u) =>
      u.agent.post("/api/agent/heartbeat").send({ deviceId: device.deviceId })
    );
    // A web session is not agent credentials.
    expect(anonymous.status).toBe(401);
    expect(anonymous.body).toEqual({ message: "Missing or invalid Authorization header" });

    for (const body of [
      {},
      { deviceId: "not-a-uuid" },
      { timestamp: new Date().toISOString() },
      { deviceId: randomUUID(), timestamp: new Date().toISOString(), clientType: "desktop" },
    ]) {
      const res = await device.request.post("/api/agent/heartbeat").send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.message).toBe("Invalid request");
      expect(Array.isArray(res.body.errors)).toBe(true);
    }

    // Quirk: `timestamp` is any string — it is only parsed later, where an
    // unparseable date silently disables accrual instead of failing.
    const nonsenseTimestamp = await heartbeat(device, { timestamp: "yesterday" });
    expect(nonsenseTimestamp.status).toBe(200);

    // Quirk: `activeApp` and `activeWindow` are accepted and then dropped —
    // the heartbeat stores nothing about what the user was looking at.
    const withWindow = await heartbeat(device, {
      activeApp: "Visual Studio Code",
      activeWindow: "agent-protocol.md — DocuFlow",
    });
    expect(withWindow.status).toBe(200);
    expect(Object.keys(withWindow.body).sort()).toEqual([
      "ok",
      "screenshotPolicy",
      "serverTime",
      "timerSync",
    ]);
  });

  // ─── Event batches ───

  it("accepts a batch once and answers every replay as a duplicate", async () => {
    const app = await makeApp();
    const { device } = await trackingUser(app);
    const batchId = randomUUID();
    const events = [
      { type: "input_activity", timestamp: new Date().toISOString(), data: { keyCount: 42, mouseCount: 15 } },
      { type: "active_window", timestamp: new Date().toISOString(), data: { appName: "Code" } },
      { type: "idle_start", timestamp: new Date().toISOString(), data: {} },
      { type: "idle_end", timestamp: new Date().toISOString() },
    ];

    const first = await batch(device, { batchId, events });
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ ok: true, accepted: 4 });

    const replay = await batch(device, { batchId, events });
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual({ ok: true, accepted: 0, duplicate: true });

    // Quirk: the id alone decides. Different events under a used batchId are
    // dropped silently, and never counted.
    const differentPayload = await batch(device, {
      batchId,
      events: [{ type: "idle_start", timestamp: new Date().toISOString() }],
    });
    expect(differentPayload.body).toEqual({ ok: true, accepted: 0, duplicate: true });
  });

  it("treats batch ids as global, so a second device cannot reuse one", async () => {
    const app = await makeApp();
    const first = await trackingUser(app);
    const second = await trackingUser(app);
    const batchId = randomUUID();

    expect((await batch(first.device, { batchId })).body).toEqual({ ok: true, accepted: 1 });

    // Quirk: `batchId` is the primary key of a single table, not scoped by
    // device or user, so an id collision between agents drops real events.
    const collision = await batch(second.device, { batchId });
    expect(collision.body).toEqual({ ok: true, accepted: 0, duplicate: true });
  });

  it("stamps the batch onto the device named in the body and marks it seen", async () => {
    const app = await makeApp();
    const user = await registerUser(app);
    const device = await loginDevice(app, user, { deviceName: "First" });
    const other = await loginDevice(app, user, { deviceName: "Second" });

    const before = await user.agent.get("/api/agent/devices");
    const otherBefore = before.body.data.find((d: { id: string }) => d.id === other.deviceId);

    // Quirk: like the heartbeat, the batch's `deviceId` is the body's, so events
    // and the lastSeenAt stamp land on a device that sent nothing.
    const res = await batch(device, { deviceId: other.deviceId });
    expect(res.body).toEqual({ ok: true, accepted: 1 });

    const after = await user.agent.get("/api/agent/devices");
    const otherAfter = after.body.data.find((d: { id: string }) => d.id === other.deviceId);
    expect(new Date(otherAfter.lastSeenAt).getTime()).toBeGreaterThan(
      new Date(otherBefore.lastSeenAt).getTime()
    );

    // Quirk: a revoked device is a valid target — unlike the heartbeat, the
    // batch route never checks revocation on the body's device.
    await user.agent.post("/api/agent/device/revoke").send({ deviceId: other.deviceId });
    const afterRevoke = await batch(device, { deviceId: other.deviceId });
    expect(afterRevoke.body).toEqual({ ok: true, accepted: 1 });

    // But a device id that does not exist violates the foreign key, and the
    // insert failure surfaces as a 500 rather than a validation error.
    const unknownDevice = await batch(device, { deviceId: randomUUID() });
    expect(unknownDevice.status).toBe(500);
    expect(unknownDevice.body).toEqual({ message: "Failed to process events batch" });
  });

  it("validates the batch envelope before it looks at idempotency", async () => {
    const app = await makeApp();
    const { device } = await trackingUser(app);

    const anonymous = await registerUser(app).then((u) =>
      u.agent.post("/api/agent/events/batch").send({})
    );
    expect(anonymous.status).toBe(401);

    const rejected: Array<[string, Record<string, unknown>]> = [
      ["no events", { events: [] }],
      ["over the cap", {
        events: Array.from({ length: 101 }, () => ({
          type: "input_activity",
          timestamp: new Date().toISOString(),
        })),
      }],
      ["unknown event type", {
        events: [{ type: "heartbeat", timestamp: new Date().toISOString() }],
      }],
      ["event with no timestamp", { events: [{ type: "idle_start" }] }],
      ["non-uuid batch id", { batchId: "batch-1" }],
      ["missing client version", { clientVersion: undefined }],
    ];
    for (const [label, body] of rejected) {
      const res = await batch(device, body);
      expect(res.status, label).toBe(400);
      expect(res.body.message).toBe("Invalid request");
    }

    // Exactly 100 is the documented cap and is accepted.
    const atCap = await batch(device, {
      events: Array.from({ length: 100 }, (_, i) => ({
        type: "input_activity",
        timestamp: new Date(Date.now() - i * 1000).toISOString(),
        data: { keyCount: i },
      })),
    });
    expect(atCap.body).toEqual({ ok: true, accepted: 100 });

    // A rejected batch never reserved its id, so the same id still works.
    const batchId = randomUUID();
    expect((await batch(device, { batchId, events: [] })).status).toBe(400);
    expect((await batch(device, { batchId })).body).toEqual({ ok: true, accepted: 1 });
  });

  it("attaches a batch to whatever entry is active when it arrives", async () => {
    const app = await makeApp();
    const { user, device, crmProjectId, taskId } = await trackingUser(app);

    // No entry running: accepted anyway, with a null association that nothing
    // ever fills in later.
    expect((await batch(device)).body).toEqual({ ok: true, accepted: 1 });

    const entry = await startTimer(user.agent, crmProjectId, taskId);
    expect((await batch(device)).body).toEqual({ ok: true, accepted: 1 });

    // Association is by the token's user and by wall-clock arrival, not by any
    // field in the batch — an event timestamped before the entry started still
    // lands on it.
    const backdated = await batch(device, {
      events: [
        {
          type: "idle_start",
          timestamp: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        },
      ],
    });
    expect(backdated.body).toEqual({ ok: true, accepted: 1 });

    await user.agent.post(`/api/time-tracking/${entry.id}/stop`);
    expect((await batch(device)).body).toEqual({ ok: true, accepted: 1 });
  });

  it("refuses ingestion from a revoked device", async () => {
    const app = await makeApp();
    const user: TestUser = await registerUser(app);
    const device = await loginDevice(app, user);

    await user.agent.post("/api/agent/device/revoke").send({ deviceId: device.deviceId });

    const beat = await heartbeat(device);
    expect(beat.status).toBe(403);
    expect(beat.body).toEqual({ code: "device_revoked", message: "Device has been revoked" });

    const events = await batch(device);
    expect(events.status).toBe(403);
    expect(events.body).toEqual({ code: "device_revoked", message: "Device has been revoked" });
  });
});

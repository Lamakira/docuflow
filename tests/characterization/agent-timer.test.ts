import { describe, it, expect, beforeEach } from "vitest";
import { makeApp } from "../helpers/app";
import { resetDb } from "../helpers/db";
import { newAgent, registerUser, type TestUser } from "../helpers/auth";
import { createCrmProject, createTask, startTimer } from "../helpers/fixtures";
import { loginDevice } from "../helpers/agent";

/**
 * Characterization: the desktop agent's half of the shared time tracker.
 *
 * `/api/agent/timer/*` writes the same `time_entries` rows the SPA's
 * `/api/time-tracking/*` routes do (frozen in `time-tracking`), but reaches them
 * through a different door: a bearer access token minted for a device, not a
 * session cookie. Both halves have to keep working through the migration, so
 * both are frozen.
 *
 * Quirks frozen here:
 *  - Agent auth is device-scoped: pairing complete creates a *new*
 *    device row on every call, so pairing twice from one machine leaves two.
 *  - `isAgentAuthenticated` already rejects a revoked device with 403, so the
 *    per-route `requireActiveDevice` check behind it can never see one — its
 *    revoked branch is unreachable.
 *  - `GET /api/agent/timer/active` answers 200 with a JSON `null` body when
 *    nothing is running, the same shape as `/api/auth/user`.
 *  - Starting silently stops whatever was already active — including an entry
 *    the SPA started — and the response describes only the new entry.
 *  - Start answers with an extra `taskAccumulatedToday` field that is not part
 *    of the entry row; an idempotent replay always reports it as 0, whatever has
 *    accrued since.
 *  - `crmProjectId` is checked for existence only — any project that exists is
 *    trackable, listed or not, matching the SPA's start route (#31) — and
 *    `deviceId` in the body is ignored, since the device comes from the token.
 *  - Ownership still guards an entry once it exists: pause, resume and stop
 *    refuse another user's entry with "Not authorized".
 */
describe("desktop agent timer (characterization)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  async function trackableProject(user: TestUser) {
    const { crmProject } = await createCrmProject(user.agent);
    const task = await createTask(user.agent, crmProject.id);
    return { crmProjectId: crmProject.id, taskId: task.id };
  }

  it("refuses password login and mints device credentials from pairing instead", async () => {
    const app = await makeApp();
    const user = await registerUser(app);

    const retired = await newAgent(app).post("/api/agent/auth/login").send({
      email: user.email,
      password: "password123",
      deviceMeta: { deviceName: "Test Workstation" },
    });
    expect(retired.status).toBe(410);
    expect(retired.body).toEqual({
      message:
        "This sign-in path has moved to pairing. Pair a Device from a signed-in DocuFlow web session.",
    });

    const start = await user.agent.post("/api/agent/pairing/start").send({});
    const res = await newAgent(app).post("/api/agent/pairing/complete").send({
      pairingCode: start.body.pairingCode,
      deviceMeta: { deviceName: "Test Workstation" },
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      user: { id: user.id, email: user.email },
    });
    expect(typeof res.body.deviceId).toBe("string");
    expect(res.body.deviceToken).toMatch(/^[0-9a-f]{96}$/);
    // Access token is a bare HS256 JWT assembled in `agentRoutes.ts`, not a
    // library token — three base64url segments.
    expect(res.body.accessToken.split(".")).toHaveLength(3);
    expect(res.body.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // Quirk: every pairing complete creates another device rather than reusing the machine's.
    const second = await loginDevice(app, user);
    expect(second.deviceId).not.toBe(res.body.deviceId);
    const devices = await user.agent.get("/api/agent/devices");
    expect(devices.status).toBe(200);
    expect(devices.body.data).toHaveLength(2);
    // Quirk: the listing hands the SPA each device's `deviceTokenHash`, which
    // nothing in the browser needs.
    expect(typeof devices.body.data[0].deviceTokenHash).toBe("string");
  });

  it("guards every timer route on the bearer token and the device behind it", async () => {
    const app = await makeApp();
    const user = await registerUser(app);
    const device = await loginDevice(app, user);

    const noHeader = await newAgent(app).get("/api/agent/timer/active");
    expect(noHeader.status).toBe(401);
    expect(noHeader.body).toEqual({ message: "Missing or invalid Authorization header" });

    const notBearer = await newAgent(app)
      .get("/api/agent/timer/active")
      .set("Authorization", device.accessToken);
    expect(notBearer.status).toBe(401);
    expect(notBearer.body).toEqual({ message: "Missing or invalid Authorization header" });

    const tampered = await newAgent(app)
      .get("/api/agent/timer/active")
      .set("Authorization", `Bearer ${device.accessToken.slice(0, -2)}xy`);
    expect(tampered.status).toBe(401);
    expect(tampered.body).toEqual({ message: "Invalid access token" });

    // Revocation is a web-session action; the agent's still-valid token stops
    // working on the next request because the middleware re-reads the device.
    const revoked = await user.agent
      .post("/api/agent/device/revoke")
      .send({ deviceId: device.deviceId });
    expect(revoked.status).toBe(200);

    const afterRevoke = await device.request.get("/api/agent/timer/active");
    expect(afterRevoke.status).toBe(403);
    expect(afterRevoke.body).toEqual({
      code: "device_revoked",
      message: "Device has been revoked",
    });

    // The refresh route reports the same revocation as 401, not 403.
    const refresh = await newAgent(app)
      .post("/api/agent/auth/refresh")
      .send({ deviceId: device.deviceId, deviceToken: device.deviceToken });
    expect(refresh.status).toBe(401);
    expect(refresh.body).toEqual({ code: "device_revoked", message: "Device has been revoked" });
  });

  it("validates a start against the project and the task, but not membership", async () => {
    const app = await makeApp();
    const user = await registerUser(app);
    const stranger = await registerUser(app);
    const device = await loginDevice(app, user);
    const { crmProjectId, taskId } = await trackableProject(user);
    const other = await trackableProject(user);

    const noProject = await device.request.post("/api/agent/timer/start").send({});
    expect(noProject.status).toBe(400);
    expect(noProject.body).toEqual({ message: "crmProjectId is required" });

    const unknownProject = await device.request
      .post("/api/agent/timer/start")
      .send({ crmProjectId: "00000000-0000-0000-0000-000000000000" });
    expect(unknownProject.status).toBe(404);
    expect(unknownProject.body).toEqual({ message: "Project not found" });

    // A stranger to the project starts a timer on it (#31): visibility is the
    // rule, as it already was on the SPA's `/api/time-tracking/start`. The entry
    // belongs to whoever started it, not to the project's owner.
    const strangerDevice = await loginDevice(app, stranger);
    const foreign = await strangerDevice.request
      .post("/api/agent/timer/start")
      .send({ crmProjectId, taskId });
    expect(foreign.status).toBe(200);
    expect(foreign.body.userId).toBe(stranger.id);
    await strangerDevice.request.post(`/api/agent/timer/${foreign.body.id}/stop`);

    // With the tasks migration applied, a task is mandatory — the same rule the
    // SPA's `/api/time-tracking/capabilities` advertises.
    const noTask = await device.request.post("/api/agent/timer/start").send({ crmProjectId });
    expect(noTask.status).toBe(400);
    expect(noTask.body).toEqual({ message: "taskId is required" });

    const foreignTask = await device.request
      .post("/api/agent/timer/start")
      .send({ crmProjectId, taskId: other.taskId });
    expect(foreignTask.status).toBe(400);
    expect(foreignTask.body).toEqual({ message: "Invalid task for this project" });
  });

  it("starts, pauses, resumes and stops an entry, enforcing the status at each step", async () => {
    const app = await makeApp();
    const user = await registerUser(app);
    const device = await loginDevice(app, user);
    const { crmProjectId, taskId } = await trackableProject(user);

    const before = await device.request.get("/api/agent/timer/active");
    expect(before.status).toBe(200);
    // Quirk: no active entry is a JSON `null` body, not `{}` or a 404.
    expect(before.body).toBeNull();

    const started = await device.request
      .post("/api/agent/timer/start")
      .send({ crmProjectId, taskId, description: "Writing the runbook" });
    expect(started.status).toBe(200);
    expect(started.body).toMatchObject({
      userId: user.id,
      crmProjectId,
      taskId,
      description: "Writing the runbook",
      status: "running",
      duration: 0,
      idleTime: 0,
      // Extra field, not part of the stored row: today's accrual for this task.
      taskAccumulatedToday: 0,
    });
    const entryId = started.body.id;

    const active = await device.request.get("/api/agent/timer/active");
    expect(active.status).toBe(200);
    expect(active.body).toMatchObject({ id: entryId, status: "running" });
    // The agent view is enriched with names the SPA looks up separately.
    expect(typeof active.body.projectName).toBe("string");
    expect(typeof active.body.taskName).toBe("string");

    const resumeWhileRunning = await device.request.post(`/api/agent/timer/${entryId}/resume`);
    expect(resumeWhileRunning.status).toBe(400);
    expect(resumeWhileRunning.body).toEqual({ message: "Entry is not paused" });

    const paused = await device.request.post(`/api/agent/timer/${entryId}/pause`);
    expect(paused.status).toBe(200);
    expect(paused.body).toMatchObject({ id: entryId, status: "paused" });

    const pauseAgain = await device.request.post(`/api/agent/timer/${entryId}/pause`);
    expect(pauseAgain.status).toBe(400);
    expect(pauseAgain.body).toEqual({ message: "Entry is not running" });

    // A paused entry is still the active one.
    const whilePaused = await device.request.get("/api/agent/timer/active");
    expect(whilePaused.body).toMatchObject({ id: entryId, status: "paused" });

    const resumed = await device.request.post(`/api/agent/timer/${entryId}/resume`);
    expect(resumed.status).toBe(200);
    expect(resumed.body).toMatchObject({ id: entryId, status: "running" });

    const stopped = await device.request.post(`/api/agent/timer/${entryId}/stop`);
    expect(stopped.status).toBe(200);
    expect(stopped.body).toMatchObject({ id: entryId, status: "stopped" });
    expect(typeof stopped.body.endTime).toBe("string");

    const stopAgain = await device.request.post(`/api/agent/timer/${entryId}/stop`);
    expect(stopAgain.status).toBe(400);
    expect(stopAgain.body).toEqual({ message: "Entry is already stopped" });

    const after = await device.request.get("/api/agent/timer/active");
    expect(after.body).toBeNull();
  });

  it("refuses to move an entry that does not exist or belongs to someone else", async () => {
    const app = await makeApp();
    const owner = await registerUser(app);
    const stranger = await registerUser(app);
    const ownerDevice = await loginDevice(app, owner);
    const strangerDevice = await loginDevice(app, stranger);
    const { crmProjectId, taskId } = await trackableProject(owner);

    const started = await ownerDevice.request
      .post("/api/agent/timer/start")
      .send({ crmProjectId, taskId });
    const entryId = started.body.id;

    for (const action of ["pause", "resume", "stop"]) {
      const missing = await ownerDevice.request.post(
        `/api/agent/timer/00000000-0000-0000-0000-000000000000/${action}`
      );
      expect(missing.status).toBe(404);
      expect(missing.body).toEqual({ message: "Time entry not found" });

      const foreign = await strangerDevice.request.post(`/api/agent/timer/${entryId}/${action}`);
      expect(foreign.status).toBe(403);
      expect(foreign.body).toEqual({ message: "Not authorized" });
    }
  });

  it("replays a start under the same clientCommandId instead of opening a second entry", async () => {
    const app = await makeApp();
    const user = await registerUser(app);
    const device = await loginDevice(app, user);
    const { crmProjectId, taskId } = await trackableProject(user);

    const first = await device.request
      .post("/api/agent/timer/start")
      .send({ crmProjectId, taskId, clientCommandId: "command-1" });
    expect(first.status).toBe(200);

    const replay = await device.request
      .post("/api/agent/timer/start")
      .send({ crmProjectId, taskId, clientCommandId: "command-1" });
    expect(replay.status).toBe(200);
    expect(replay.body.id).toBe(first.body.id);
    // Quirk: the replay short-circuits before the accrual lookup, so this is
    // hard-coded to 0 rather than recomputed.
    expect(replay.body.taskAccumulatedToday).toBe(0);

    // A different command id starts a fresh entry and silently stops the first.
    const second = await device.request
      .post("/api/agent/timer/start")
      .send({ crmProjectId, taskId, clientCommandId: "command-2" });
    expect(second.body.id).not.toBe(first.body.id);

    const active = await device.request.get("/api/agent/timer/active");
    expect(active.body.id).toBe(second.body.id);

    const entries = await user.agent.get("/api/time-tracking/entries");
    const firstEntry = entries.body.data.find((e: { id: string }) => e.id === first.body.id);
    expect(firstEntry.status).toBe("stopped");
  });

  it("shares one set of entries with the SPA in both directions", async () => {
    const app = await makeApp();
    const user = await registerUser(app);
    const device = await loginDevice(app, user);
    const { crmProjectId, taskId } = await trackableProject(user);

    // Started in the browser, controlled from the desktop.
    const fromSpa = await startTimer(user.agent, crmProjectId, taskId);
    const seenByAgent = await device.request.get("/api/agent/timer/active");
    expect(seenByAgent.body.id).toBe(fromSpa.id);

    const pausedByAgent = await device.request.post(`/api/agent/timer/${fromSpa.id}/pause`);
    expect(pausedByAgent.status).toBe(200);

    const seenBySpa = await user.agent.get("/api/time-tracking/active");
    expect(seenBySpa.body).toMatchObject({ id: fromSpa.id, status: "paused" });

    // Started on the desktop, stopped in the browser. The agent start also
    // silently stops the paused entry above.
    const fromAgent = await device.request
      .post("/api/agent/timer/start")
      .send({ crmProjectId, taskId });
    expect(fromAgent.status).toBe(200);

    const entries = await user.agent.get("/api/time-tracking/entries");
    const superseded = entries.body.data.find((e: { id: string }) => e.id === fromSpa.id);
    expect(superseded.status).toBe("stopped");

    const stoppedBySpa = await user.agent.post(`/api/time-tracking/${fromAgent.body.id}/stop`);
    expect(stoppedBySpa.status).toBe(200);

    const agentSeesNothing = await device.request.get("/api/agent/timer/active");
    expect(agentSeesNothing.body).toBeNull();
  });
});

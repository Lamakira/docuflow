import { describe, it, expect, beforeEach } from "vitest";
import { makeApp } from "../helpers/app";
import { resetDb } from "../helpers/db";
import { registerAdmin, registerUser } from "../helpers/auth";
import { createCrmProject, createTask, startTimer } from "../helpers/fixtures";

/**
 * Characterization: the time tracker the SPA and the desktop agent share.
 *
 * Quirks frozen here:
 *  - With the tasks migration applied, `taskId` is mandatory on start; the
 *    `capabilities` endpoint is how a client discovers that.
 *  - Starting a timer silently stops whatever was already running, and reports
 *    only the new entry.
 *  - Duration accrues in whole seconds from `lastActivityAt`, so a fast test
 *    accumulates 0 — the ordering and status transitions are the contract, not
 *    the wall-clock numbers.
 *  - Pause/resume/stop enforce the current status and answer 400 when it does
 *    not match; the activity heartbeat instead returns the entry untouched.
 *  - Resuming counts the paused span as idle time unless `discardIdleTime` is
 *    sent.
 *  - Non-admins see only their own entries; the `userId` filter is honoured for
 *    admins and ignored for everyone else.
 *  - `PATCH` accepts only `description`; delete answers `{ success: true }`.
 */
describe("time tracking (characterization)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("advertises that a task is required and enforces it on start", async () => {
    const app = await makeApp();
    const user = await registerUser(app);
    const { crmProject } = await createCrmProject(user.agent);
    const otherProject = await createCrmProject(user.agent);
    const task = await createTask(user.agent, crmProject.id);
    const foreignTask = await createTask(user.agent, otherProject.crmProject.id);

    const capabilities = await user.agent.get("/api/time-tracking/capabilities");
    expect(capabilities.status).toBe(200);
    expect(capabilities.body).toEqual({ requiresTask: true });

    const noProject = await user.agent.post("/api/time-tracking/start").send({});
    expect(noProject.status).toBe(400);
    expect(noProject.body).toEqual({ message: "Project is required" });

    const noTask = await user.agent
      .post("/api/time-tracking/start")
      .send({ crmProjectId: crmProject.id });
    expect(noTask.status).toBe(400);
    expect(noTask.body).toEqual({ message: "taskId is required" });

    const wrongProject = await user.agent
      .post("/api/time-tracking/start")
      .send({ crmProjectId: crmProject.id, taskId: foreignTask.id });
    expect(wrongProject.status).toBe(400);
    expect(wrongProject.body).toEqual({ message: "Invalid task for this project" });

    await user.agent.patch(`/api/tasks/${task.id}`).send({ status: "archived" });
    const archived = await user.agent
      .post("/api/time-tracking/start")
      .send({ crmProjectId: crmProject.id, taskId: task.id });
    expect(archived.status).toBe(400);
    expect(archived.body).toEqual({ message: "Cannot start timer on an archived task" });
  });

  it("starts a timer, exposes it as active, and auto-stops it when another starts", async () => {
    const app = await makeApp();
    const user = await registerUser(app);
    const { crmProject } = await createCrmProject(user.agent);
    const first = await createTask(user.agent, crmProject.id, "First task");
    const second = await createTask(user.agent, crmProject.id, "Second task");

    const noneActive = await user.agent.get("/api/time-tracking/active");
    expect(noneActive.status).toBe(200);
    expect(noneActive.body).toBeNull();

    const started = await startTimer(user.agent, crmProject.id, first.id, "Writing the brief");
    expect(started).toMatchObject({
      crmProjectId: crmProject.id,
      taskId: first.id,
      description: "Writing the brief",
      status: "running",
      duration: 0,
      idleTime: 0,
    });

    const active = await user.agent.get("/api/time-tracking/active");
    expect(active.body.id).toBe(started.id);

    const replacement = await startTimer(user.agent, crmProject.id, second.id);
    expect(replacement.id).not.toBe(started.id);

    // Quirk: the previous entry is stopped as a side effect and never mentioned
    // in the response.
    const entries = await user.agent.get("/api/time-tracking/entries");
    const previous = entries.body.data.find((e: { id: string }) => e.id === started.id);
    expect(previous.status).toBe("stopped");
    expect(typeof previous.endTime).toBe("string");
    expect((await user.agent.get("/api/time-tracking/active")).body.id).toBe(replacement.id);
  });

  it("walks an entry through pause, resume and stop, refusing out-of-order calls", async () => {
    const app = await makeApp();
    const user = await registerUser(app);
    const { crmProject } = await createCrmProject(user.agent);
    const task = await createTask(user.agent, crmProject.id);
    const entry = await startTimer(user.agent, crmProject.id, task.id);

    const resumeWhileRunning = await user.agent.post(`/api/time-tracking/${entry.id}/resume`);
    expect(resumeWhileRunning.status).toBe(400);
    expect(resumeWhileRunning.body).toEqual({ message: "Entry is not paused" });

    const paused = await user.agent.post(`/api/time-tracking/${entry.id}/pause`);
    expect(paused.status).toBe(200);
    expect(paused.body).toMatchObject({ id: entry.id, status: "paused" });
    expect(paused.body.duration).toBeGreaterThanOrEqual(0);

    const pausedTwice = await user.agent.post(`/api/time-tracking/${entry.id}/pause`);
    expect(pausedTwice.status).toBe(400);
    expect(pausedTwice.body).toEqual({ message: "Entry is not running" });

    // Quirk: the heartbeat is the one transition that never errors — it returns
    // the entry untouched when it is not running.
    const heartbeatWhilePaused = await user.agent.post(`/api/time-tracking/${entry.id}/activity`);
    expect(heartbeatWhilePaused.status).toBe(200);
    expect(heartbeatWhilePaused.body).toMatchObject({ id: entry.id, status: "paused" });

    const resumed = await user.agent.post(`/api/time-tracking/${entry.id}/resume`).send({});
    expect(resumed.status).toBe(200);
    expect(resumed.body).toMatchObject({ id: entry.id, status: "running" });
    expect(resumed.body.idleTime).toBeGreaterThanOrEqual(0);

    const heartbeat = await user.agent.post(`/api/time-tracking/${entry.id}/activity`);
    expect(heartbeat.status).toBe(200);
    expect(heartbeat.body.status).toBe("running");

    const stopped = await user.agent.post(`/api/time-tracking/${entry.id}/stop`);
    expect(stopped.status).toBe(200);
    expect(stopped.body).toMatchObject({ id: entry.id, status: "stopped" });
    expect(typeof stopped.body.endTime).toBe("string");

    const stoppedTwice = await user.agent.post(`/api/time-tracking/${entry.id}/stop`);
    expect(stoppedTwice.status).toBe(400);
    expect(stoppedTwice.body).toEqual({ message: "Entry is already stopped" });

    expect((await user.agent.get("/api/time-tracking/active")).body).toBeNull();
  });

  it("discards the paused span as idle time only when asked", async () => {
    const app = await makeApp();
    const user = await registerUser(app);
    const { crmProject } = await createCrmProject(user.agent);
    const task = await createTask(user.agent, crmProject.id);
    const entry = await startTimer(user.agent, crmProject.id, task.id);

    await user.agent.post(`/api/time-tracking/${entry.id}/pause`);
    const discarded = await user.agent
      .post(`/api/time-tracking/${entry.id}/resume`)
      .send({ discardIdleTime: true });
    expect(discarded.status).toBe(200);
    expect(discarded.body.idleTime).toBe(0);
  });

  it("refuses another user's entry on every transition", async () => {
    const app = await makeApp();
    const user = await registerUser(app);
    const stranger = await registerUser(app);
    const { crmProject } = await createCrmProject(user.agent);
    const task = await createTask(user.agent, crmProject.id);
    const entry = await startTimer(user.agent, crmProject.id, task.id);

    for (const action of ["pause", "resume", "stop", "activity"]) {
      const res = await stranger.agent.post(`/api/time-tracking/${entry.id}/${action}`);
      expect(res.status, action).toBe(403);
      expect(res.body, action).toEqual({ message: "Not authorized" });
    }

    const missing = await user.agent.post(
      "/api/time-tracking/00000000-0000-0000-0000-000000000000/stop"
    );
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ message: "Time entry not found" });
  });

  it("shows non-admins only their own entries and lets admins filter by user", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);
    const member = await registerUser(app);
    const { crmProject } = await createCrmProject(admin.agent);
    const task = await createTask(admin.agent, crmProject.id);

    const adminEntry = await startTimer(admin.agent, crmProject.id, task.id);
    await admin.agent.post(`/api/time-tracking/${adminEntry.id}/stop`);
    const memberEntry = await startTimer(member.agent, crmProject.id, task.id);
    await member.agent.post(`/api/time-tracking/${memberEntry.id}/stop`);

    const asMember = await member.agent.get("/api/time-tracking/entries");
    expect(asMember.status).toBe(200);
    expect(asMember.body.data.map((e: { id: string }) => e.id)).toEqual([memberEntry.id]);

    // Quirk: a non-admin asking for someone else's entries is silently rewritten
    // to their own, not refused.
    const memberAsking = await member.agent
      .get("/api/time-tracking/entries")
      .query({ userId: admin.id });
    expect(memberAsking.body.data.map((e: { id: string }) => e.id)).toEqual([memberEntry.id]);

    const asAdmin = await admin.agent.get("/api/time-tracking/entries");
    expect(asAdmin.body.data).toHaveLength(2);

    const filtered = await admin.agent
      .get("/api/time-tracking/entries")
      .query({ userId: member.id });
    expect(filtered.body.data.map((e: { id: string }) => e.id)).toEqual([memberEntry.id]);

    const byProject = await member.agent.get(`/api/time-tracking/project/${crmProject.id}`);
    expect(byProject.status).toBe(200);
    expect(byProject.body.data.map((e: { id: string }) => e.id)).toEqual([memberEntry.id]);

    const byProjectAsAdmin = await admin.agent.get(`/api/time-tracking/project/${crmProject.id}`);
    expect(byProjectAsAdmin.body.data).toHaveLength(2);
  });

  it("summarises stopped entries into stats, grouped by project and user", async () => {
    const app = await makeApp();
    const user = await registerUser(app, { firstName: "Sam", lastName: "Stats" });
    const { crmProject, project } = await createCrmProject(user.agent, { name: "Stats Project" });
    const task = await createTask(user.agent, crmProject.id);

    const entry = await startTimer(user.agent, crmProject.id, task.id);
    await user.agent.post(`/api/time-tracking/${entry.id}/stop`);
    // A still-running entry is excluded from the summary.
    await startTimer(user.agent, crmProject.id, task.id);

    const res = await user.agent.get("/api/time-tracking/stats");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ entriesCount: 1, totalIdleTime: 0 });
    expect(typeof res.body.totalDuration).toBe("number");
    expect(res.body.byProject).toEqual([
      { crmProjectId: crmProject.id, projectName: "Stats Project", totalDuration: expect.any(Number) },
    ]);
    expect(res.body.byUser).toEqual([
      { userId: user.id, userName: "Sam Stats", totalDuration: expect.any(Number) },
    ]);
    expect(project.id).toBeTruthy();
  });

  it("edits only the description, and deletes for the owner or an admin", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);
    const member = await registerUser(app);
    const { crmProject } = await createCrmProject(admin.agent);
    const task = await createTask(admin.agent, crmProject.id);
    const entry = await startTimer(member.agent, crmProject.id, task.id, "before");

    const updated = await member.agent
      .patch(`/api/time-tracking/${entry.id}`)
      .send({ description: "after", duration: 99999, status: "stopped" });
    expect(updated.status).toBe(200);
    expect(updated.body.description).toBe("after");
    // Quirk: everything except the description is dropped without comment.
    expect(updated.body.duration).toBe(0);
    expect(updated.body.status).toBe("running");

    const foreignEdit = await admin.agent
      .patch(`/api/time-tracking/${entry.id}`)
      .send({ description: "admin edit" });
    // Quirk: editing is owner-only even for an admin, though deleting is not.
    expect(foreignEdit.status).toBe(403);

    const deleted = await admin.agent.delete(`/api/time-tracking/${entry.id}`);
    expect(deleted.status).toBe(200);
    expect(deleted.body).toEqual({ success: true });

    const missing = await admin.agent.delete(
      "/api/time-tracking/00000000-0000-0000-0000-000000000000"
    );
    expect(missing.status).toBe(404);
  });
});

import { randomUUID } from "crypto";
import { describe, it, expect, beforeEach } from "vitest";
import { makeApp } from "../helpers/app";
import { resetDb } from "../helpers/db";
import { newAgent, registerUser } from "../helpers/auth";
import { createCrmProject, createTask } from "../helpers/fixtures";
import { loginDevice, type AgentDevice } from "../helpers/agent";

/**
 * Characterization: what the desktop agent reads and writes besides the timer —
 * the project and task pickers behind the start dialog, the day totals on the
 * widget, and the capability flag that decides whether a task is mandatory.
 *
 * Divergence from `docs/agent-protocol.md`: the document has no section for any
 * of this. §6 says "[PLACEHOLDER] Timer control from agent (start/stop) deferred
 * to Phase 3", so the whole read/write surface the agent's UI is built on —
 * `/api/agent/capabilities`, `/api/agent/projects`, `/api/agent/tasks`,
 * `/api/agent/worked-today`, `/api/agent/today-breakdown` — is undocumented.
 *
 * Behavior quirks frozen here:
 *  - Existence is the whole rule: the picker is workspace-wide, and the
 *    endpoints behind it check only that the id resolves. Anything the desktop
 *    offers, it can open; a documentation-only project, which the picker never
 *    offers, opens too. #31 removed the membership gate that used to make the
 *    picker lie — it was the only such gate in the product, and the SPA's task
 *    routes never had one. ADR-0019 records that as a temporary exception to
 *    ADR-0004 and ADR-0006, which these assertions move with when it lifts.
 *  - The agent and the SPA share one workspace: a project created from the
 *    desktop is a normal CRM project, owned by whoever created it.
 *  - Day totals count stopped entries only; the running one is the client's job
 *    to add, so a widget that trusts the server alone reads low.
 *  - The day window comes from the client, unvalidated — the agent decides what
 *    "today" means, and a malformed window is a server error.
 */
describe("desktop agent workspace (characterization)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  async function agentUser(app: Awaited<ReturnType<typeof makeApp>>) {
    const user = await registerUser(app);
    const device = await loginDevice(app, user);
    return { user, device };
  }

  /** The day window the desktop sends, computed from its own local midnight. */
  function today(): { start: string; end: string } {
    const now = new Date();
    return {
      start: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).toISOString(),
      end: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).toISOString(),
    };
  }

  async function startAndStop(device: AgentDevice, crmProjectId: string, taskId: string) {
    const started = await device.request
      .post("/api/agent/timer/start")
      .send({ crmProjectId, taskId });
    await device.request.post(`/api/agent/timer/${started.body.id}/stop`);
    return started.body.id as string;
  }

  it("tells the agent whether a task is mandatory", async () => {
    const app = await makeApp();
    const { device } = await agentUser(app);

    const anonymous = await newAgent(app).get("/api/agent/capabilities");
    expect(anonymous.status).toBe(401);

    const res = await device.request.get("/api/agent/capabilities");
    expect(res.status).toBe(200);
    // The tasks table exists in this schema, so the timer refuses a start
    // without a task — the same answer the SPA's capabilities endpoint gives.
    expect(res.body).toEqual({ requiresTask: true });
  });

  it("lists every project in the workspace, and opens the ones it lists", async () => {
    const app = await makeApp();
    const { user, device } = await agentUser(app);
    const stranger = await registerUser(app);

    const empty = await device.request.get("/api/agent/projects");
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual({ data: [] });

    const { crmProject } = await createCrmProject(user.agent, { name: "Agent Visible" });
    const theirs = await createCrmProject(stranger.agent, { name: "Someone Else's" });

    // Quirk: the picker is workspace-wide. `getCrmProjects` takes a user id and
    // ignores it, so the desktop offers every project to every agent. New
    // projects sort first, by `updatedAt` descending.
    const listed = await device.request.get("/api/agent/projects");
    expect(listed.body.data).toEqual([
      { id: theirs.crmProject.id, name: "Someone Else's", status: "lead" },
      { id: crmProject.id, name: "Agent Visible", status: "lead" },
    ]);

    // And picking the stranger's project works — the list and the endpoints
    // behind it agree now (#31). Before, this was a 403 on every project the
    // caller could see but held no membership on.
    const tasks = await device.request
      .get("/api/agent/tasks")
      .query({ crmProjectId: theirs.crmProject.id });
    expect(tasks.status).toBe(200);
    expect(tasks.body).toEqual({ data: [] });
  });

  it("creates a CRM project the browser sees too", async () => {
    const app = await makeApp();
    const { user, device } = await agentUser(app);

    for (const body of [{}, { name: "   " }, { name: 42 }]) {
      const res = await device.request.post("/api/agent/projects").send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body).toEqual({ message: "Project name is required" });
    }

    const created = await device.request
      .post("/api/agent/projects")
      .send({ name: "  Started From The Desktop  " });
    expect(created.status).toBe(201);
    expect(created.body).toEqual({
      id: expect.any(String),
      name: "Started From The Desktop",
      // A new CRM project starts in the "lead" stage; the route's `?? "active"`
      // fallback is dead code, since the row always has a status.
      status: "lead",
    });

    // One workspace, two doors: the SPA's CRM list has it, owned by the caller.
    const fromBrowser = await user.agent.get("/api/crm/projects");
    expect(fromBrowser.body.data).toHaveLength(1);
    expect(fromBrowser.body.data[0]).toMatchObject({
      id: created.body.id,
      project: { name: "Started From The Desktop", ownerId: user.id },
    });

    // Quirk: nothing stops two projects sharing a name.
    const duplicate = await device.request
      .post("/api/agent/projects")
      .send({ name: "Started From The Desktop" });
    expect(duplicate.status).toBe(201);
    expect(duplicate.body.id).not.toBe(created.body.id);
  });

  it("lists a project's tasks with what the caller already tracked on them today", async () => {
    const app = await makeApp();
    const { user, device } = await agentUser(app);
    const stranger = await registerUser(app);
    const strangersDevice = await loginDevice(app, stranger);
    const { crmProject } = await createCrmProject(user.agent);
    const task = await createTask(user.agent, crmProject.id, "Write the runbook");

    const missingProject = await device.request.get("/api/agent/tasks");
    expect(missingProject.status).toBe(400);
    expect(missingProject.body).toEqual({ message: "crmProjectId is required" });

    const unknownProject = await device.request
      .get("/api/agent/tasks")
      .query({ crmProjectId: randomUUID() });
    expect(unknownProject.status).toBe(404);
    expect(unknownProject.body).toEqual({ message: "Project not found" });

    // A caller with no membership on the project reads its tasks like anyone
    // else — `durationToday` is per-caller, so the stranger's own total is zero.
    const foreign = await strangersDevice.request
      .get("/api/agent/tasks")
      .query({ crmProjectId: crmProject.id });
    expect(foreign.status).toBe(200);
    expect(foreign.body.data).toEqual([
      { id: task.id, name: "Write the runbook", status: "open", durationToday: 0 },
    ]);

    const listed = await device.request
      .get("/api/agent/tasks")
      .query({ crmProjectId: crmProject.id });
    expect(listed.status).toBe(200);
    expect(listed.body.data).toEqual([
      { id: task.id, name: "Write the runbook", status: "open", durationToday: 0 },
    ]);

    // `durationToday` counts stopped entries only, so it stays at zero while the
    // timer is still running on the task.
    await device.request
      .post("/api/agent/timer/start")
      .send({ crmProjectId: crmProject.id, taskId: task.id });
    const whileRunning = await device.request
      .get("/api/agent/tasks")
      .query({ crmProjectId: crmProject.id });
    expect(whileRunning.body.data[0].durationToday).toBe(0);
  });

  it("creates a task under any project the caller can see", async () => {
    const app = await makeApp();
    const { user, device } = await agentUser(app);
    const stranger = await registerUser(app);
    const strangersDevice = await loginDevice(app, stranger);
    const { crmProject } = await createCrmProject(user.agent);

    for (const body of [
      {},
      { crmProjectId: crmProject.id },
      { crmProjectId: crmProject.id, name: "   " },
      { name: "No project" },
    ]) {
      const res = await device.request.post("/api/agent/tasks").send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body).toEqual({ message: "crmProjectId and name are required" });
    }

    const unknownProject = await device.request
      .post("/api/agent/tasks")
      .send({ crmProjectId: randomUUID(), name: "Orphan" });
    expect(unknownProject.status).toBe(404);

    // The project must exist, but the caller need not belong to it — the same
    // rule the SPA's `POST /api/tasks` has always had (#31).
    const foreign = await strangersDevice.request
      .post("/api/agent/tasks")
      .send({ crmProjectId: crmProject.id, name: "Not mine" });
    expect(foreign.status).toBe(201);
    expect(foreign.body.name).toBe("Not mine");

    const created = await device.request
      .post("/api/agent/tasks")
      .send({ crmProjectId: crmProject.id, name: "  Draft the ADR  ", description: "  why  " });
    expect(created.status).toBe(201);
    expect(created.body).toEqual({
      id: expect.any(String),
      name: "Draft the ADR",
      status: "open",
      crmProjectId: crmProject.id,
    });

    // The task is a normal one: the browser lists it and the timer accepts it.
    const fromBrowser = await user.agent.get("/api/tasks").query({ crmProjectId: crmProject.id });
    expect(fromBrowser.body.data.map((t: { id: string }) => t.id)).toContain(created.body.id);

    const started = await device.request
      .post("/api/agent/timer/start")
      .send({ crmProjectId: crmProject.id, taskId: created.body.id });
    expect(started.status).toBe(200);
  });

  it("totals the day from stopped entries inside the window the client asks for", async () => {
    const app = await makeApp();
    const { user, device } = await agentUser(app);
    const { crmProject } = await createCrmProject(user.agent);
    const task = await createTask(user.agent, crmProject.id);

    const anonymous = await newAgent(app).get("/api/agent/worked-today");
    expect(anonymous.status).toBe(401);

    const nothing = await device.request.get("/api/agent/worked-today");
    expect(nothing.status).toBe(200);
    expect(nothing.body).toEqual({ total: 0 });

    await startAndStop(device, crmProject.id, task.id);
    const window = today();

    const counted = await device.request.get("/api/agent/worked-today").query(window);
    expect(counted.status).toBe(200);
    expect(typeof counted.body.total).toBe("number");

    // Quirk: the running entry contributes nothing — the desktop is expected to
    // add its own live elapsed on top, so the server total alone reads low.
    await device.request
      .post("/api/agent/timer/start")
      .send({ crmProjectId: crmProject.id, taskId: task.id });
    const whileRunning = await device.request.get("/api/agent/worked-today").query(window);
    expect(whileRunning.body.total).toBe(counted.body.total);

    // The window is whatever the client sends; yesterday's is empty.
    const yesterday = {
      start: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
      end: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    };
    const past = await device.request.get("/api/agent/worked-today").query(yesterday);
    expect(past.body).toEqual({ total: 0 });

    // Quirk: an unparseable window is not rejected — it reaches the query and
    // comes back as a server error.
    const malformed = await device.request
      .get("/api/agent/worked-today")
      .query({ start: "today", end: "tomorrow" });
    expect(malformed.status).toBe(500);
    expect(malformed.body).toEqual({ message: "Failed to fetch worked today" });
  });

  it("breaks the day down by project and task", async () => {
    const app = await makeApp();
    const { user, device } = await agentUser(app);
    const { crmProject } = await createCrmProject(user.agent, { name: "Breakdown Project" });
    const first = await createTask(user.agent, crmProject.id, "First task");
    const second = await createTask(user.agent, crmProject.id, "Second task");

    const empty = await device.request.get("/api/agent/today-breakdown").query(today());
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual({ rows: [] });

    await startAndStop(device, crmProject.id, first.id);
    await startAndStop(device, crmProject.id, first.id);
    await startAndStop(device, crmProject.id, second.id);

    const res = await device.request.get("/api/agent/today-breakdown").query(today());
    expect(res.status).toBe(200);
    // Two stops on one task collapse into a single row; the grouping key is
    // (project, task), not the entry.
    expect(res.body.rows).toHaveLength(2);
    expect(res.body.rows).toContainEqual({
      projectName: "Breakdown Project",
      taskId: first.id,
      taskName: "First task",
      stoppedSeconds: expect.any(Number),
    });
    expect(res.body.rows).toContainEqual({
      projectName: "Breakdown Project",
      taskId: second.id,
      taskName: "Second task",
      stoppedSeconds: expect.any(Number),
    });

    // Same rule as the day total: a running entry has no row of its own.
    await device.request
      .post("/api/agent/timer/start")
      .send({ crmProjectId: crmProject.id, taskId: second.id });
    const whileRunning = await device.request.get("/api/agent/today-breakdown").query(today());
    expect(whileRunning.body.rows).toHaveLength(2);

    const malformed = await device.request
      .get("/api/agent/today-breakdown")
      .query({ start: "today" });
    expect(malformed.status).toBe(500);
    expect(malformed.body).toEqual({ message: "Failed to fetch today breakdown" });
  });
});

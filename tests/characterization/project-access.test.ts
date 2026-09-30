import { beforeEach, describe, expect, it } from "vitest";
import { makeApp } from "../helpers/app";
import { resetDb } from "../helpers/db";
import { registerAdmin, registerUser, setWorkspaceRole } from "../helpers/auth";
import { createCrmProject, createTask } from "../helpers/fixtures";
import { loginDevice } from "../helpers/agent";

/**
 * #310: Project Assignment is who may see a Project. The Owner and
 * Administrators reach every Project. A Member reaches one they belong to, or
 * one they are assigned while it has no Members. Anyone else gets the answer
 * a Project they cannot see gets, from the browser and from the desktop agent.
 */
describe("Project access follows Project Assignment (#310)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("answers a Member who is not on the Project as if it were not there, and leaves it out of the lists", async () => {
    const app = await makeApp();
    const lead = await registerUser(app);
    const outsider = await registerUser(app);
    const created = await createCrmProject(lead.agent, { name: "Harbor" });
    const task = await createTask(lead.agent, created.crmProject.id, "Write the runbook");
    const tag = await lead.agent.post("/api/crm/tags").send({ name: "Retainer" });
    const note = await lead.agent.post(`/api/crm/projects/${created.crmProject.id}/notes`).send({
      content: "Kickoff done",
    });
    await lead.agent.post(`/api/crm/projects/${created.crmProject.id}/tags/${tag.body.id}`);
    const device = await loginDevice(app, outsider);
    const id = created.crmProject.id;

    const refused = [
      await outsider.agent.get(`/api/crm/projects/${id}`),
      await outsider.agent.patch(`/api/crm/projects/${id}`).send({ projectName: "Defaced" }),
      await outsider.agent.get(`/api/crm/projects/by-project/${created.project.id}`),
      await outsider.agent.get(`/api/projects/${created.project.id}`),
      await outsider.agent.patch(`/api/projects/${created.project.id}`).send({ name: "Defaced" }),
      await outsider.agent.patch(`/api/crm/projects/${id}/documentation`).send({ enabled: true }),
      await outsider.agent.post(`/api/crm/projects/${id}/lost`).send({ lostReason: "price" }),
      await outsider.agent.post(`/api/crm/projects/${id}/clone`),
      await outsider.agent.get(`/api/crm/projects/${id}/tags`),
      await outsider.agent.post(`/api/crm/projects/${id}/tags/${tag.body.id}`),
      await outsider.agent.delete(`/api/crm/projects/${id}/tags/${tag.body.id}`),
      await outsider.agent.get(`/api/crm/projects/${id}/stage-history`),
      await outsider.agent.get(`/api/crm/projects/${id}/notes`),
      await outsider.agent.post(`/api/crm/projects/${id}/notes`).send({ content: "Intruder" }),
      await outsider.agent.patch(`/api/crm/projects/${id}/notes/${note.body.id}`).send({ content: "Defaced" }),
      await outsider.agent.delete(`/api/crm/projects/${id}/notes/${note.body.id}`),
      await outsider.agent.get(`/api/crm/projects/${id}/members`),
      await outsider.agent.post(`/api/crm/projects/${id}/members`).send({}),
      await outsider.agent.get(`/api/crm/projects/${id}/reminders`),
      await outsider.agent.post(`/api/crm/projects/${id}/reminders`).send({
        title: "Intruder",
        dueAt: "2026-10-01T09:00:00.000Z",
      }),
      await outsider.agent.get("/api/tasks").query({ crmProjectId: id }),
      await outsider.agent.post("/api/tasks").send({ crmProjectId: id, name: "Intruder" }),
      await outsider.agent.patch(`/api/tasks/${task.id}`).send({ name: "Defaced" }),
      await outsider.agent.delete(`/api/tasks/${task.id}`),
      await outsider.agent.post("/api/time-tracking/start").send({ crmProjectId: id, taskId: task.id }),
      await outsider.agent.post("/api/daily-updates").send({ crmProjectId: id, status: "on_track" }),
      await device.request.get("/api/agent/tasks").query({ crmProjectId: id }),
      await device.request.post("/api/agent/tasks").send({ crmProjectId: id, name: "Intruder" }),
      await device.request.post("/api/agent/timer/start").send({ crmProjectId: id, taskId: task.id }),
    ];
    for (const res of refused) {
      expect(res.status, `${res.req.method} ${res.req.path}`).toBe(404);
    }

    const names = (body: { data: Array<{ project?: { name: string }; name?: string }> }) =>
      body.data.map((row) => row.project?.name ?? row.name);
    for (const res of [
      await outsider.agent.get("/api/crm/projects").query({ pageSize: 50 }),
      await outsider.agent.get("/api/crm/projects/all"),
      await outsider.agent.get("/api/crm/projects/all-kanban"),
      await device.request.get("/api/agent/projects"),
    ]) {
      expect(res.status).toBe(200);
      expect(names(res.body)).not.toContain("Harbor");
    }
    const projects = await outsider.agent.get("/api/projects");
    expect(projects.status).toBe(200);
    expect(projects.body.map((project: { name: string }) => project.name)).not.toContain("Harbor");

    const mine = await createCrmProject(outsider.agent, { name: "Lighthouse" });
    const swapped = await outsider.agent
      .patch(`/api/crm/projects/${mine.crmProject.id}/notes/${note.body.id}`)
      .send({ content: "Defaced" });
    expect(swapped.status).toBe(404);
    const swappedDelete = await outsider.agent.delete(
      `/api/crm/projects/${mine.crmProject.id}/notes/${note.body.id}`,
    );
    expect(swappedDelete.status).toBe(204);
    expect((await lead.agent.get(`/api/crm/projects/${id}/notes`)).body[0].content).toBe("Kickoff done");

    const still = await lead.agent.get(`/api/crm/projects/${id}`);
    expect(still.status).toBe(200);
    expect(still.body.project.name).toBe("Harbor");
    expect((await lead.agent.get(`/api/crm/projects/${id}/notes`)).body).toHaveLength(1);
    expect((await lead.agent.get("/api/tasks").query({ crmProjectId: id })).body.data).toHaveLength(1);
  });

  it("keeps the Owner, Administrators, the Project's Members and its assignee while it has no Members", async () => {
    const app = await makeApp();
    const lead = await registerUser(app);
    const teammate = await registerUser(app);
    const assignee = await registerUser(app);
    const admin = await registerAdmin(app);
    const owner = await registerUser(app);
    await setWorkspaceRole(owner.id, "owner");

    const staffed = await createCrmProject(lead.agent, { name: "Staffed", memberIds: [lead.id, teammate.id] });
    for (const reader of [teammate, admin, owner]) {
      const res = await reader.agent.get(`/api/crm/projects/${staffed.crmProject.id}`);
      expect(res.status).toBe(200);
      expect(res.body.project.name).toBe("Staffed");
      const listed = await reader.agent.get("/api/crm/projects").query({ pageSize: 50 });
      expect(listed.body.data.map((row: { project: { name: string } }) => row.project.name)).toContain("Staffed");
    }

    const unstaffed = await createCrmProject(admin.agent, { name: "Assigned", memberIds: [], assigneeId: assignee.id });
    const removed = await admin.agent.delete(`/api/crm/projects/${unstaffed.crmProject.id}/members/${assignee.id}`);
    expect(removed.status).toBeLessThan(300);
    expect((await assignee.agent.get(`/api/crm/projects/${unstaffed.crmProject.id}`)).status).toBe(200);
    expect((await lead.agent.get(`/api/crm/projects/${unstaffed.crmProject.id}`)).status).toBe(404);
    const assigneeList = await assignee.agent.get("/api/projects");
    expect(assigneeList.body.map((project: { name: string }) => project.name)).toContain("Assigned");
  });
});

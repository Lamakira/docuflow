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

  it("lets a Member reach the Opportunities they own, though someone else created them", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);
    const seller = await registerUser(app);
    const successor = await registerUser(app);
    const created = await createCrmProject(admin.agent, {
      name: "Beacon deal",
      status: "lead",
      opportunityOwnerId: seller.id,
    });
    const id = created.crmProject.id;
    const listed = async (reader: typeof seller) =>
      (await reader.agent.get("/api/crm/projects").query({ pageSize: 50 })).body.data.map(
        (row: { project: { name: string } }) => row.project.name,
      );

    expect((await seller.agent.get(`/api/crm/projects/${id}`)).status).toBe(200);
    expect(await listed(seller)).toContain("Beacon deal");
    expect((await seller.agent.get(`/api/projects/${created.project.id}/files`)).status).toBe(200);
    expect((await successor.agent.get(`/api/crm/projects/${id}`)).status).toBe(404);

    const handedOver = await admin.agent.patch(`/api/crm/projects/${id}`).send({ opportunityOwnerId: successor.id });
    expect(handedOver.status).toBe(200);
    expect((await successor.agent.get(`/api/crm/projects/${id}`)).status).toBe(200);
    expect(await listed(successor)).toContain("Beacon deal");
  });

  it("lets only its author edit or delete a note, not even the Owner or Administrators", async () => {
    const app = await makeApp();
    const author = await registerUser(app);
    const teammate = await registerUser(app);
    const admin = await registerAdmin(app);
    const owner = await registerUser(app);
    await setWorkspaceRole(owner.id, "owner");
    const created = await createCrmProject(author.agent, { name: "Harbor", memberIds: [author.id, teammate.id] });
    const id = created.crmProject.id;
    const note = await author.agent.post(`/api/crm/projects/${id}/notes`).send({ content: "Kickoff done" });
    const contents = async () =>
      (await author.agent.get(`/api/crm/projects/${id}/notes`)).body.map((row: { content: string }) => row.content);

    for (const other of [teammate, admin, owner]) {
      const edited = await other.agent.patch(`/api/crm/projects/${id}/notes/${note.body.id}`).send({ content: "Rewritten" });
      expect(edited.status).toBe(403);
      expect((await other.agent.delete(`/api/crm/projects/${id}/notes/${note.body.id}`)).status).toBe(403);
    }
    expect(await contents()).toEqual(["Kickoff done"]);

    const own = await author.agent.patch(`/api/crm/projects/${id}/notes/${note.body.id}`).send({ content: "Kickoff moved" });
    expect(own.status).toBe(200);
    expect(await contents()).toEqual(["Kickoff moved"]);
    expect((await author.agent.delete(`/api/crm/projects/${id}/notes/${note.body.id}`)).status).toBe(204);
    expect(await contents()).toEqual([]);
  });

  it("leaves a Project the Member cannot reach out of the documentation lists", async () => {
    const app = await makeApp();
    const lead = await registerUser(app);
    const outsider = await registerUser(app);
    const created = await createCrmProject(lead.agent, { name: "Harbor" });
    const enabled = await lead.agent
      .patch(`/api/crm/projects/${created.crmProject.id}/documentation`)
      .send({ enabled: true });
    expect(enabled.status).toBe(200);

    const everyName = (body: Array<{ name: string }>) => body.map((project) => project.name);
    const pageNames = (body: { data: Array<{ project: { name: string } }>; projects: Array<{ name: string }> }) => [
      ...body.data.map((row) => row.project.name),
      ...body.projects.map((project) => project.name),
    ];

    const whole = await outsider.agent.get("/api/projects/documentable");
    expect(whole.status).toBe(200);
    expect(everyName(whole.body)).not.toContain("Harbor");
    const paged = await outsider.agent.get("/api/projects/documentable").query({ page: 1 });
    expect(paged.status).toBe(200);
    expect(pageNames(paged.body)).not.toContain("Harbor");

    expect(everyName((await lead.agent.get("/api/projects/documentable")).body)).toContain("Harbor");
    expect(pageNames((await lead.agent.get("/api/projects/documentable").query({ page: 1 })).body)).toContain("Harbor");
  });
});

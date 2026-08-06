import { describe, it, expect, beforeEach } from "vitest";
import { makeApp } from "../helpers/app";
import { resetDb } from "../helpers/db";
import { registerAdmin, registerUser } from "../helpers/auth";
import { createCrmProject, createTask } from "../helpers/fixtures";

/**
 * Characterization: tasks, project membership, and per-user reminders.
 *
 * Quirks frozen here:
 *  - The task routes answer 200, not 201/204, and wrap the list in `{ data }`.
 *  - Tasks are not scoped to membership: any authenticated user can create,
 *    rename or delete a task on any project, and `crmProjectId` is never checked
 *    against an existing project on create.
 *  - `GET /api/tasks` hides archived tasks unless `includeArchived=true`.
 *  - Membership is self-service: adding or removing yourself always works;
 *    acting on someone else needs project ownership or the admin role.
 *  - Leaving a project you were never in still answers `{ ok: true }`.
 *  - Reminders are strictly per-user — you only ever see and edit your own.
 */
describe("tasks, members and reminders (characterization)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("creates, lists, updates, archives and deletes tasks", async () => {
    const app = await makeApp();
    const user = await registerUser(app);
    const { crmProject } = await createCrmProject(user.agent);

    const created = await user.agent
      .post("/api/tasks")
      .send({ crmProjectId: crmProject.id, name: "  Draft the brief  ", description: " with detail " });
    // Quirk: create answers 200, not 201.
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({
      crmProjectId: crmProject.id,
      // Both fields are trimmed on the way in.
      name: "Draft the brief",
      description: "with detail",
      status: "open",
    });

    const second = await createTask(user.agent, crmProject.id, "Second task");

    const list = await user.agent.get("/api/tasks").query({ crmProjectId: crmProject.id });
    expect(list.status).toBe(200);
    expect(list.body.data.map((t: { id: string }) => t.id)).toEqual([created.body.id, second.id]);

    const archived = await user.agent
      .patch(`/api/tasks/${second.id}`)
      .send({ status: "archived", name: "Second archived" });
    expect(archived.status).toBe(200);
    expect(archived.body).toMatchObject({ status: "archived", name: "Second archived" });

    const withoutArchived = await user.agent.get("/api/tasks").query({ crmProjectId: crmProject.id });
    expect(withoutArchived.body.data.map((t: { id: string }) => t.id)).toEqual([created.body.id]);

    const withArchived = await user.agent
      .get("/api/tasks")
      .query({ crmProjectId: crmProject.id, includeArchived: "true" });
    expect(withArchived.body.data).toHaveLength(2);

    const deleted = await user.agent.delete(`/api/tasks/${second.id}`);
    expect(deleted.status).toBe(200);
    expect(deleted.body).toEqual({ ok: true });

    const deletedAgain = await user.agent.delete(`/api/tasks/${second.id}`);
    expect(deletedAgain.status).toBe(404);
    expect(deletedAgain.body).toEqual({ message: "Task not found" });
  });

  it("validates the task payload, but not that the project exists", async () => {
    const app = await makeApp();
    const user = await registerUser(app);

    const noProject = await user.agent.get("/api/tasks");
    expect(noProject.status).toBe(400);
    expect(noProject.body).toEqual({ message: "crmProjectId is required" });

    const noName = await user.agent
      .post("/api/tasks")
      .send({ crmProjectId: "00000000-0000-0000-0000-000000000000" });
    expect(noName.status).toBe(400);
    expect(noName.body).toEqual({ message: "crmProjectId and name are required" });

    const blankName = await user.agent
      .post("/api/tasks")
      .send({ crmProjectId: "00000000-0000-0000-0000-000000000000", name: "   " });
    expect(blankName.status).toBe(400);

    // Quirk: only the foreign key stops a task on a project that does not exist,
    // and the failure is reported as a 500.
    const unknownProject = await user.agent
      .post("/api/tasks")
      .send({ crmProjectId: "00000000-0000-0000-0000-000000000000", name: "Orphan" });
    expect(unknownProject.status).toBe(500);
    expect(unknownProject.body).toEqual({ message: "Failed to create task" });
  });

  it("lets anyone join a project but restricts adding and removing other people", async () => {
    const app = await makeApp();
    const owner = await registerUser(app);
    const outsider = await registerUser(app);
    const bystander = await registerUser(app);
    const { crmProject } = await createCrmProject(owner.agent);

    const joined = await outsider.agent.post(`/api/crm/projects/${crmProject.id}/members`).send({});
    expect(joined.status).toBe(201);
    expect(joined.body).toMatchObject({ crmProjectId: crmProject.id, userId: outsider.id });

    // Joining twice returns the row that already existed.
    const again = await outsider.agent.post(`/api/crm/projects/${crmProject.id}/members`).send({});
    expect(again.status).toBe(201);
    expect(again.body.id).toBe(joined.body.id);

    const refused = await outsider.agent
      .post(`/api/crm/projects/${crmProject.id}/members`)
      .send({ userId: bystander.id });
    expect(refused.status).toBe(403);
    expect(refused.body).toEqual({ message: "Only project owner or admin can add other members" });

    const byOwner = await owner.agent
      .post(`/api/crm/projects/${crmProject.id}/members`)
      .send({ userId: bystander.id });
    expect(byOwner.status).toBe(201);

    const members = await owner.agent.get(`/api/crm/projects/${crmProject.id}/members`);
    expect(members.status).toBe(200);
    expect(members.body.map((m: { userId: string }) => m.userId)).toEqual([
      owner.id,
      outsider.id,
      bystander.id,
    ]);
    // Members carry an allowlisted user projection.
    expect(Object.keys(members.body[0].user).sort()).toEqual(
      ["email", "firstName", "id", "lastName", "profileImageUrl"].sort()
    );

    const refusedRemoval = await outsider.agent.delete(
      `/api/crm/projects/${crmProject.id}/members/${bystander.id}`
    );
    expect(refusedRemoval.status).toBe(403);
    expect(refusedRemoval.body).toEqual({
      message: "Only project owner or admin can remove other members",
    });

    const left = await outsider.agent.delete(`/api/crm/projects/${crmProject.id}/members/me`);
    expect(left.status).toBe(200);
    expect(left.body).toEqual({ ok: true });

    // Quirk: leaving is unconditional — no membership, no project check, still ok.
    const leftAgain = await outsider.agent.delete(
      "/api/crm/projects/00000000-0000-0000-0000-000000000000/members/me"
    );
    expect(leftAgain.status).toBe(200);
    expect(leftAgain.body).toEqual({ ok: true });

    const removedByOwner = await owner.agent.delete(
      `/api/crm/projects/${crmProject.id}/members/${bystander.id}`
    );
    expect(removedByOwner.status).toBe(200);

    const missingProject = await owner.agent.get(
      "/api/crm/projects/00000000-0000-0000-0000-000000000000/members"
    );
    expect(missingProject.status).toBe(404);
    expect(missingProject.body).toEqual({ message: "Project not found" });
  });

  it("lets an admin manage membership on a project they do not own", async () => {
    const app = await makeApp();
    const owner = await registerUser(app);
    const admin = await registerAdmin(app);
    const member = await registerUser(app);
    const { crmProject } = await createCrmProject(owner.agent);

    const added = await admin.agent
      .post(`/api/crm/projects/${crmProject.id}/members`)
      .send({ userId: member.id });
    expect(added.status).toBe(201);

    const removed = await admin.agent.delete(
      `/api/crm/projects/${crmProject.id}/members/${member.id}`
    );
    expect(removed.status).toBe(200);
  });

  it("creates reminders for the caller only, linking tasks from the same project", async () => {
    const app = await makeApp();
    const user = await registerUser(app);
    const other = await registerUser(app);
    const { crmProject } = await createCrmProject(user.agent);
    const otherProject = await createCrmProject(user.agent);
    const task = await createTask(user.agent, crmProject.id);
    const foreignTask = await createTask(user.agent, otherProject.crmProject.id);

    const created = await user.agent.post(`/api/crm/projects/${crmProject.id}/reminders`).send({
      title: "  Chase the client  ",
      note: "  before Friday  ",
      dueAt: "2026-09-01T10:00:00.000Z",
      taskId: task.id,
      // Quirk: userId in the body is ignored — it comes from the session.
      userId: other.id,
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      userId: user.id,
      crmProjectId: crmProject.id,
      taskId: task.id,
      title: "Chase the client",
      note: "before Friday",
      status: "upcoming",
      notified: 0,
      notifiedInApp: 0,
      emailSent: 0,
    });
    expect(created.body.dueAt).toBe("2026-09-01T10:00:00.000Z");

    const wrongProjectTask = await user.agent
      .post(`/api/crm/projects/${crmProject.id}/reminders`)
      .send({ title: "Bad link", dueAt: "2026-09-01T10:00:00.000Z", taskId: foreignTask.id });
    expect(wrongProjectTask.status).toBe(400);
    expect(wrongProjectTask.body).toEqual({ message: "Task does not belong to this project" });

    const badDate = await user.agent
      .post(`/api/crm/projects/${crmProject.id}/reminders`)
      .send({ title: "Bad date", dueAt: "not-a-date" });
    expect(badDate.status).toBe(400);
    expect(badDate.body.message).toBe("Invalid data");

    const unknownProject = await user.agent
      .post("/api/crm/projects/00000000-0000-0000-0000-000000000000/reminders")
      .send({ title: "Orphan", dueAt: "2026-09-01T10:00:00.000Z" });
    expect(unknownProject.status).toBe(404);
    expect(unknownProject.body).toEqual({ message: "Project not found" });

    // Only the owner sees it.
    const mine = await user.agent.get(`/api/crm/projects/${crmProject.id}/reminders`);
    expect(mine.body.map((r: { id: string }) => r.id)).toEqual([created.body.id]);
    const theirs = await other.agent.get(`/api/crm/projects/${crmProject.id}/reminders`);
    expect(theirs.body).toEqual([]);
  });

  it("updates and deletes only your own reminders", async () => {
    const app = await makeApp();
    const user = await registerUser(app);
    const other = await registerUser(app);
    const { crmProject } = await createCrmProject(user.agent);
    const created = await user.agent
      .post(`/api/crm/projects/${crmProject.id}/reminders`)
      .send({ title: "Original", dueAt: "2026-09-01T10:00:00.000Z" });

    const updated = await user.agent
      .patch(`/api/reminders/${created.body.id}`)
      .send({ title: "  Updated  ", status: "done", dueAt: "2026-10-01T09:00:00.000Z" });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ title: "Updated", status: "done" });
    expect(updated.body.dueAt).toBe("2026-10-01T09:00:00.000Z");

    const badStatus = await user.agent
      .patch(`/api/reminders/${created.body.id}`)
      .send({ status: "snoozed" });
    expect(badStatus.status).toBe(400);
    expect(badStatus.body).toEqual({ message: "Invalid status" });

    const badDate = await user.agent
      .patch(`/api/reminders/${created.body.id}`)
      .send({ dueAt: "nonsense" });
    expect(badDate.status).toBe(400);
    expect(badDate.body).toEqual({ message: "Invalid due date" });

    const foreignUpdate = await other.agent
      .patch(`/api/reminders/${created.body.id}`)
      .send({ title: "Hijacked" });
    expect(foreignUpdate.status).toBe(403);
    expect(foreignUpdate.body).toEqual({ message: "Not authorized" });

    const foreignDelete = await other.agent.delete(`/api/reminders/${created.body.id}`);
    expect(foreignDelete.status).toBe(403);

    const missing = await user.agent
      .patch("/api/reminders/00000000-0000-0000-0000-000000000000")
      .send({ title: "Nobody" });
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ message: "Reminder not found" });

    const deleted = await user.agent.delete(`/api/reminders/${created.body.id}`);
    expect(deleted.status).toBe(200);
    expect(deleted.body).toEqual({ ok: true });
  });
});

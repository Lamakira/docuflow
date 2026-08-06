import { describe, it, expect, beforeEach } from "vitest";
import { makeApp } from "../helpers/app";
import { resetDb } from "../helpers/db";
import { registerUser } from "../helpers/auth";
import { createClient, createCrmProject } from "../helpers/fixtures";
import { emailsTo } from "../fakes/resend";

/**
 * Characterization: CRM projects — the source of truth from which documentation
 * projects are created.
 *
 * Quirks frozen here:
 *  - Creation is atomic across both tables and answers `{ project, crmProject }`.
 *  - Name uniqueness is enforced in application code, case-insensitively and
 *    trimmed, and is checked against the first 1000 rows only.
 *  - Documentation-only projects are hidden from every CRM listing.
 *  - `?search=` filters the page that pagination already selected, and `total`
 *    stays the unfiltered count — so a search can return fewer rows than it says.
 *  - `PATCH` splits its payload: `projectName`/`projectDescription` update the
 *    documentation project, everything else the CRM row.
 *  - Moving into a "review" status starts a review clock; moving out of it adds
 *    the elapsed time to `totalReviewMs` and pushes `dueDate` out by the same
 *    amount.
 *  - Assigning someone else creates a notification and sends them an email;
 *    assigning yourself does neither.
 */
describe("CRM projects (characterization)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("creates the documentation project and the CRM row together", async () => {
    const app = await makeApp();
    const user = await registerUser(app);
    const client = await createClient(user.agent);

    const res = await user.agent.post("/api/crm/projects").send({
      name: "Website Rebuild",
      description: "Marketing site",
      clientId: client.id,
      status: "won_in_progress",
      projectType: "monthly",
      budgetedHours: 40,
      documentationEnabled: true,
    });

    expect(res.status).toBe(201);
    expect(res.body.project).toMatchObject({
      name: "Website Rebuild",
      description: "Marketing site",
      icon: "folder",
      ownerId: user.id,
    });
    expect(res.body.crmProject).toMatchObject({
      projectId: res.body.project.id,
      clientId: client.id,
      status: "won_in_progress",
      // Quirk (bug, frozen deliberately): `createCrmProjectWithBase` never
      // forwards `projectType`, so the requested "monthly" is dropped and the
      // column default wins. Only a later PATCH can set the type.
      projectType: "one_time",
      budgetedHours: 40,
      // Booleans are persisted as 0/1 integers.
      documentationEnabled: 1,
      isDocumentationOnly: 0,
      totalReviewMs: 0,
      reviewStartedAt: null,
    });

    const invalid = await user.agent.post("/api/crm/projects").send({ description: "no name" });
    expect(invalid.status).toBe(400);
    expect(invalid.body.message).toBe("Invalid data");
  });

  it("rejects a duplicate name regardless of case or surrounding space", async () => {
    const app = await makeApp();
    const user = await registerUser(app);
    const other = await registerUser(app);
    await createCrmProject(user.agent, { name: "Apollo" });

    const sameCase = await user.agent.post("/api/crm/projects").send({ name: "Apollo" });
    expect(sameCase.status).toBe(409);
    expect(sameCase.body).toEqual({ message: 'A project named "Apollo" already exists' });

    const differentCase = await user.agent.post("/api/crm/projects").send({ name: "  aPOLLo " });
    expect(differentCase.status).toBe(409);

    // Quirk: the check reads every project in the workspace, so the clash also
    // applies across users despite the "per user" comment in the route.
    const otherUser = await other.agent.post("/api/crm/projects").send({ name: "Apollo" });
    expect(otherUser.status).toBe(409);
  });

  it("auto-adds the creator as a member and honours an explicit member list", async () => {
    const app = await makeApp();
    const owner = await registerUser(app);
    const teammate = await registerUser(app);

    const withDefaults = await createCrmProject(owner.agent, { name: "Default members" });
    const defaultMembers = await owner.agent.get(
      `/api/crm/projects/${withDefaults.crmProject.id}/members`
    );
    expect(defaultMembers.body.map((m: { userId: string }) => m.userId)).toEqual([owner.id]);

    const excludingCreator = await createCrmProject(owner.agent, {
      name: "Explicit members",
      memberIds: [teammate.id],
    });
    const explicitMembers = await owner.agent.get(
      `/api/crm/projects/${excludingCreator.crmProject.id}/members`
    );
    // Quirk: passing memberIds without the creator removes the creator again.
    expect(explicitMembers.body.map((m: { userId: string }) => m.userId)).toEqual([teammate.id]);

    const withAssignee = await createCrmProject(owner.agent, {
      name: "Assigned",
      assigneeId: teammate.id,
    });
    const assigneeMembers = await owner.agent.get(
      `/api/crm/projects/${withAssignee.crmProject.id}/members`
    );
    expect(assigneeMembers.body.map((m: { userId: string }) => m.userId).sort()).toEqual(
      [owner.id, teammate.id].sort()
    );
  });

  it("paginates, filters by status, and hides documentation-only projects", async () => {
    const app = await makeApp();
    const user = await registerUser(app);

    await createCrmProject(user.agent, { name: "Lead one" });
    const won = await createCrmProject(user.agent, { name: "Won one", status: "won" });
    await createCrmProject(user.agent, { name: "Docs only", isDocumentationOnly: true });

    const page = await user.agent.get("/api/crm/projects").query({ page: 1, pageSize: 10 });
    expect(page.status).toBe(200);
    expect(page.body).toMatchObject({ page: 1, pageSize: 10, total: 2 });
    expect(page.body.data.map((p: { project: { name: string } }) => p.project.name)).toEqual([
      "Won one",
      "Lead one",
    ]);

    const byStatus = await user.agent.get("/api/crm/projects").query({ status: "won" });
    expect(byStatus.body.total).toBe(1);
    expect(byStatus.body.data[0].id).toBe(won.crmProject.id);

    const firstPage = await user.agent.get("/api/crm/projects").query({ page: 1, pageSize: 1 });
    expect(firstPage.body.data).toHaveLength(1);
    expect(firstPage.body.total).toBe(2);

    const kanban = await user.agent.get("/api/crm/projects/all-kanban");
    expect(kanban.status).toBe(200);
    expect(kanban.body).toMatchObject({ page: 1, pageSize: 10000, total: 2 });
  });

  it("applies ?search after pagination, leaving total unfiltered", async () => {
    const app = await makeApp();
    const user = await registerUser(app);
    await createCrmProject(user.agent, { name: "Alpha search" });
    await createCrmProject(user.agent, { name: "Beta other" });

    const res = await user.agent.get("/api/crm/projects").query({ search: "alpha" });
    expect(res.status).toBe(200);
    expect(res.body.data.map((p: { project: { name: string } }) => p.project.name)).toEqual([
      "Alpha search",
    ]);
    // Quirk: `total` is the count before the search filter runs, so paging on it
    // over-reports by design.
    expect(res.body.total).toBe(2);
  });

  it("returns a single CRM project with its project, client and members inlined", async () => {
    const app = await makeApp();
    const user = await registerUser(app);
    const client = await createClient(user.agent, { name: "Inlined Client" });
    const created = await createCrmProject(user.agent, { clientId: client.id });

    const res = await user.agent.get(`/api/crm/projects/${created.crmProject.id}`);
    expect(res.status).toBe(200);
    expect(res.body.project.id).toBe(created.project.id);
    expect(res.body.client).toMatchObject({ id: client.id, name: "Inlined Client" });
    expect(Array.isArray(res.body.client.contacts)).toBe(true);
    expect(res.body.members.map((m: { userId: string }) => m.userId)).toEqual([user.id]);

    const missing = await user.agent.get("/api/crm/projects/00000000-0000-0000-0000-000000000000");
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ message: "CRM Project not found" });
  });

  it("looks a CRM project up by its documentation project id, and deletes through it", async () => {
    const app = await makeApp();
    const user = await registerUser(app);
    const created = await createCrmProject(user.agent);

    const found = await user.agent.get(`/api/crm/projects/by-project/${created.project.id}`);
    expect(found.status).toBe(200);
    expect(found.body.id).toBe(created.crmProject.id);
    // Quirk: this route returns the bare CRM row — no `project`, `client` or
    // `members` — unlike `GET /api/crm/projects/:id`.
    expect(found.body).not.toHaveProperty("project");

    const missing = await user.agent.get(
      "/api/crm/projects/by-project/00000000-0000-0000-0000-000000000000"
    );
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ message: "Project not found in CRM" });

    const deleted = await user.agent.delete(`/api/crm/projects/by-project/${created.project.id}`);
    expect(deleted.status).toBe(204);

    // Deleting the CRM row cascades to the documentation project.
    const project = await user.agent.get(`/api/projects/${created.project.id}`);
    expect(project.status).toBe(404);
  });

  it("splits a patch between the documentation project and the CRM row", async () => {
    const app = await makeApp();
    const user = await registerUser(app);
    const created = await createCrmProject(user.agent, { name: "Before" });

    const res = await user.agent.patch(`/api/crm/projects/${created.crmProject.id}`).send({
      projectName: "After",
      projectDescription: "New description",
      comments: "internal note",
      budgetedHours: 12,
      startDate: "2026-01-02T00:00:00.000Z",
      dueDate: "2026-02-03T00:00:00.000Z",
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ comments: "internal note", budgetedHours: 12 });
    expect(res.body.startDate).toBe("2026-01-02T00:00:00.000Z");
    // Quirk: the CRM response carries no project fields, so the caller has to
    // re-read the project to see the rename it just asked for.
    expect(res.body).not.toHaveProperty("projectName");

    const project = await user.agent.get(`/api/projects/${created.project.id}`);
    expect(project.body).toMatchObject({ name: "After", description: "New description" });

    const cleared = await user.agent
      .patch(`/api/crm/projects/${created.crmProject.id}`)
      .send({ dueDate: null });
    expect(cleared.body.dueDate).toBeNull();
  });

  it("records stage history whenever the status changes", async () => {
    const app = await makeApp();
    const user = await registerUser(app);
    const created = await createCrmProject(user.agent);

    const empty = await user.agent.get(`/api/crm/projects/${created.crmProject.id}/stage-history`);
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual([]);

    await user.agent
      .patch(`/api/crm/projects/${created.crmProject.id}`)
      .send({ status: "proposal_sent" });
    await user.agent.patch(`/api/crm/projects/${created.crmProject.id}`).send({ status: "won" });
    // Re-sending the same status is not a change and records nothing.
    await user.agent.patch(`/api/crm/projects/${created.crmProject.id}`).send({ status: "won" });

    const history = await user.agent.get(`/api/crm/projects/${created.crmProject.id}/stage-history`);
    expect(history.body).toHaveLength(2);
    expect(history.body.map((h: { fromStatus: string; toStatus: string }) => [h.fromStatus, h.toStatus])).toEqual(
      expect.arrayContaining([
        ["lead", "proposal_sent"],
        ["proposal_sent", "won"],
      ])
    );
    expect(history.body[0].changedById).toBe(user.id);
  });

  it("clocks time spent in review and pushes the due date out by the same amount", async () => {
    const app = await makeApp();
    const user = await registerUser(app);
    const created = await createCrmProject(user.agent, { dueDate: "2026-03-01T00:00:00.000Z" });

    const entered = await user.agent
      .patch(`/api/crm/projects/${created.crmProject.id}`)
      .send({ status: "won_in_review" });
    expect(entered.status).toBe(200);
    expect(typeof entered.body.reviewStartedAt).toBe("string");
    expect(entered.body.totalReviewMs).toBe(0);
    expect(entered.body.dueDate).toBe("2026-03-01T00:00:00.000Z");

    const exited = await user.agent
      .patch(`/api/crm/projects/${created.crmProject.id}`)
      .send({ status: "won_completed" });
    expect(exited.status).toBe(200);
    expect(exited.body.reviewStartedAt).toBeNull();
    expect(exited.body.totalReviewMs).toBeGreaterThanOrEqual(0);
    // The due date moves out by exactly the review duration.
    const shifted = new Date(exited.body.dueDate).getTime();
    const original = new Date("2026-03-01T00:00:00.000Z").getTime();
    expect(shifted - original).toBe(exited.body.totalReviewMs);
  });

  it("notifies and emails a new assignee, but not when you assign yourself", async () => {
    const app = await makeApp();
    const owner = await registerUser(app, { firstName: "Owner" });
    const teammate = await registerUser(app, { firstName: "Team" });
    const created = await createCrmProject(owner.agent, { name: "Assignable" });

    const selfAssign = await owner.agent
      .patch(`/api/crm/projects/${created.crmProject.id}`)
      .send({ assigneeId: owner.id });
    expect(selfAssign.status).toBe(200);
    expect((await owner.agent.get("/api/notifications")).body).toEqual([]);
    expect(emailsTo(owner.email)).toHaveLength(0);

    const assign = await owner.agent
      .patch(`/api/crm/projects/${created.crmProject.id}`)
      .send({ assigneeId: teammate.id });
    expect(assign.status).toBe(200);
    expect(assign.body.assigneeId).toBe(teammate.id);

    const notifications = await teammate.agent.get("/api/notifications");
    expect(notifications.body).toHaveLength(1);
    expect(notifications.body[0]).toMatchObject({
      type: "assignment",
      crmProjectId: created.crmProject.id,
      fromUserId: owner.id,
      message: 'Owner assigned you to "Assignable"',
    });

    const mail = emailsTo(teammate.email);
    expect(mail).toHaveLength(1);
    expect(mail[0].subject).toBe('DocuFlow - You\'ve been assigned to "Assignable"');

    // The assignee is added as a member as a side effect.
    const members = await owner.agent.get(`/api/crm/projects/${created.crmProject.id}/members`);
    expect(members.body.map((m: { userId: string }) => m.userId)).toContain(teammate.id);
  });

  it("toggles documentation on and off", async () => {
    const app = await makeApp();
    const user = await registerUser(app);
    const created = await createCrmProject(user.agent);

    const enabled = await user.agent
      .patch(`/api/crm/projects/${created.crmProject.id}/documentation`)
      .send({ enabled: true });
    expect(enabled.status).toBe(200);
    expect(enabled.body.documentationEnabled).toBe(1);
    expect(
      (await user.agent.get("/api/projects/documentable")).body.map((p: { id: string }) => p.id)
    ).toEqual([created.project.id]);

    // Enabling documentation on an empty project seeds starter pages as a side
    // effect — nothing in the response says so.
    const seeded = await user.agent.get(`/api/projects/${created.project.id}/documents`);
    expect(seeded.body.length).toBeGreaterThan(0);
    expect(seeded.body.map((d: { title: string }) => d.title)).toContain("Resources");

    const disabled = await user.agent
      .patch(`/api/crm/projects/${created.crmProject.id}/documentation`)
      .send({ enabled: false });
    expect(disabled.body.documentationEnabled).toBe(0);

    const invalid = await user.agent
      .patch(`/api/crm/projects/${created.crmProject.id}/documentation`)
      .send({ enabled: "yes" });
    expect(invalid.status).toBe(400);
    expect(invalid.body.message).toBe("Invalid data");
  });

  it("clones a project under a copied name with dates and progress reset", async () => {
    const app = await makeApp();
    const user = await registerUser(app);
    const client = await createClient(user.agent);
    const source = await createCrmProject(user.agent, {
      name: "Original",
      description: "Source description",
      clientId: client.id,
      status: "won",
      projectType: "monthly",
      budgetedHours: 30,
      actualHours: 25,
      startDate: "2026-01-01T00:00:00.000Z",
      dueDate: "2026-02-01T00:00:00.000Z",
    });

    const res = await user.agent.post(`/api/crm/projects/${source.crmProject.id}/clone`);
    expect(res.status).toBe(201);
    expect(res.body.project).toMatchObject({
      name: "Original (Copy)",
      description: "Source description",
    });
    expect(res.body.crmProject).toMatchObject({
      clientId: client.id,
      // Same dropped-field quirk as on create: the source's type never survives.
      projectType: "one_time",
      budgetedHours: 30,
      // Reset on clone:
      status: "lead",
      startDate: null,
      dueDate: null,
      actualFinishDate: null,
      actualHours: null,
    });

    // Quirk: cloning bypasses the duplicate-name check, so cloning twice creates
    // two projects both named "Original (Copy)".
    const second = await user.agent.post(`/api/crm/projects/${source.crmProject.id}/clone`);
    expect(second.status).toBe(201);
    expect(second.body.project.name).toBe("Original (Copy)");

    const missing = await user.agent.post(
      "/api/crm/projects/00000000-0000-0000-0000-000000000000/clone"
    );
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ message: "Source project not found" });
  });

  it("deletes a CRM project and its documentation project", async () => {
    const app = await makeApp();
    const user = await registerUser(app);
    const created = await createCrmProject(user.agent);

    const res = await user.agent.delete(`/api/crm/projects/${created.crmProject.id}`);
    expect(res.status).toBe(204);

    expect((await user.agent.get(`/api/crm/projects/${created.crmProject.id}`)).status).toBe(404);
    expect((await user.agent.get(`/api/projects/${created.project.id}`)).status).toBe(404);

    const missing = await user.agent.delete(
      "/api/crm/projects/00000000-0000-0000-0000-000000000000"
    );
    expect(missing.status).toBe(404);
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import { makeApp } from "../helpers/app";
import { resetDb } from "../helpers/db";
import { grantDailyUpdatesAccess, registerAdmin, registerUser } from "../helpers/auth";
import { createCrmProject } from "../helpers/fixtures";

/**
 * Characterization: per-project daily updates and the dashboards built on them.
 *
 * Quirks frozen here:
 *  - `userId` is derived from the session; the API schema omits it entirely.
 *  - Editing or deleting someone else's update answers 403 "Forbidden" — a
 *    different wording from the "Not authorized" used elsewhere.
 *  - A unique index covers (project, user, updateDate), so two updates for the
 *    same explicit date collide and surface as a 500.
 *  - The admin dashboards accept either the admin role or the per-user
 *    `canViewDailyUpdates` flag.
 *  - The KPI endpoint counts "today" against the server's local calendar day,
 *    while `today-status` uses the America/Toronto day key.
 */
describe("project daily updates (characterization)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("creates an update for the caller and lists it back by day", async () => {
    const app = await makeApp();
    const user = await registerUser(app);
    const other = await registerUser(app);
    const { crmProject } = await createCrmProject(user.agent);

    const created = await user.agent.post("/api/daily-updates").send({
      crmProjectId: crmProject.id,
      status: "on_track",
      whatHappened: "Kickoff",
      whatWasDone: "Set up the repo",
      nextSteps: "Wire the API",
      waitingOnClient: true,
      updateDate: "2026-04-10T09:00:00.000Z",
      // Quirk: a userId in the body is not part of the schema and is dropped.
      userId: other.id,
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      crmProjectId: crmProject.id,
      userId: user.id,
      status: "on_track",
      whatHappened: "Kickoff",
      waitingOnClient: true,
      needsClientUpdate: false,
      needsClientSubmission: false,
    });
    expect(created.body.updateDate).toBe("2026-04-10T09:00:00.000Z");

    const mine = await user.agent.get("/api/daily-updates");
    expect(mine.status).toBe(200);
    expect(mine.body.map((u: { id: string }) => u.id)).toEqual([created.body.id]);
    expect(mine.body[0].crmProject.project.id).toBeTruthy();
    expect(mine.body[0].user.id).toBe(user.id);

    const sameDay = await user.agent.get("/api/daily-updates").query({ date: "2026-04-10" });
    expect(sameDay.body).toHaveLength(1);

    const otherDay = await user.agent.get("/api/daily-updates").query({ date: "2026-04-11" });
    expect(otherDay.body).toEqual([]);

    // Strictly per-user.
    expect((await other.agent.get("/api/daily-updates")).body).toEqual([]);

    const invalid = await user.agent.post("/api/daily-updates").send({ status: "on_track" });
    expect(invalid.status).toBe(400);
    expect(invalid.body.message).toBe("Invalid data");
  });

  it("rejects a second update for the same project, user and timestamp", async () => {
    const app = await makeApp();
    const user = await registerUser(app);
    const { crmProject } = await createCrmProject(user.agent);
    const payload = {
      crmProjectId: crmProject.id,
      status: "in_progress",
      updateDate: "2026-04-12T08:00:00.000Z",
    };

    expect((await user.agent.post("/api/daily-updates").send(payload)).status).toBe(201);

    // Quirk: the unique index is the only guard, so the duplicate is a 500.
    const duplicate = await user.agent.post("/api/daily-updates").send(payload);
    expect(duplicate.status).toBe(500);
    expect(duplicate.body).toEqual({ message: "Failed to create daily update" });
  });

  it("edits and deletes only your own update", async () => {
    const app = await makeApp();
    const user = await registerUser(app);
    const other = await registerUser(app);
    const { crmProject } = await createCrmProject(user.agent);
    const created = await user.agent
      .post("/api/daily-updates")
      .send({ crmProjectId: crmProject.id, status: "in_progress" });

    const updated = await user.agent
      .patch(`/api/daily-updates/${created.body.id}`)
      .send({ status: "blocked_client", nextSteps: "Chase the client" });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ status: "blocked_client", nextSteps: "Chase the client" });

    const foreign = await other.agent
      .patch(`/api/daily-updates/${created.body.id}`)
      .send({ status: "on_track" });
    expect(foreign.status).toBe(403);
    expect(foreign.body).toEqual({ message: "Forbidden" });

    const missing = await user.agent
      .patch("/api/daily-updates/00000000-0000-0000-0000-000000000000")
      .send({ status: "on_track" });
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ message: "Not found" });

    const foreignDelete = await other.agent.delete(`/api/daily-updates/${created.body.id}`);
    expect(foreignDelete.status).toBe(403);

    const deleted = await user.agent.delete(`/api/daily-updates/${created.body.id}`);
    expect(deleted.status).toBe(200);
    expect(deleted.body).toEqual({ success: true });
  });

  it("opens the dashboard to admins and to users holding the daily-updates flag", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);
    const manager = await registerUser(app);
    const member = await registerUser(app);
    const { crmProject } = await createCrmProject(admin.agent);

    await member.agent
      .post("/api/daily-updates")
      .send({ crmProjectId: crmProject.id, status: "on_track" });

    const refused = await manager.agent.get("/api/admin/daily-updates");
    expect(refused.status).toBe(403);
    expect(refused.body).toEqual({ message: "Access denied" });

    await grantDailyUpdatesAccess(manager.id);
    const allowed = await manager.agent.get("/api/admin/daily-updates");
    expect(allowed.status).toBe(200);
    expect(allowed.body).toHaveLength(1);
    expect(allowed.body[0].userId).toBe(member.id);

    const asAdmin = await admin.agent.get("/api/admin/daily-updates");
    expect(asAdmin.body).toHaveLength(1);

    const filtered = await admin.agent
      .get("/api/admin/daily-updates")
      .query({ userId: admin.id });
    expect(filtered.body).toEqual([]);

    const byProject = await admin.agent
      .get("/api/admin/daily-updates")
      .query({ crmProjectId: crmProject.id });
    expect(byProject.body).toHaveLength(1);
  });

  it("summarises the dashboard into KPIs", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);
    const member = await registerUser(app);
    const { crmProject } = await createCrmProject(admin.agent);

    await member.agent.post("/api/daily-updates").send({
      crmProjectId: crmProject.id,
      status: "blocked_client",
      waitingOnClient: true,
    });
    await admin.agent.post("/api/daily-updates").send({
      crmProjectId: crmProject.id,
      status: "on_track",
      updateDate: "2026-04-01T09:00:00.000Z",
    });

    const res = await admin.agent.get("/api/admin/daily-updates/kpis");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      total: 2,
      waitingOnClient: 1,
      blocked: 1,
      activeUsers: 2,
      activeProjects: 1,
      // Only the update stamped with today's date counts.
      todayUpdates: 1,
    });
  });

  it("splits today's members into submitted and missing", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);
    const submitted = await registerUser(app, { firstName: "Sub" });
    const missing = await registerUser(app, { firstName: "Miss" });
    const { crmProject } = await createCrmProject(admin.agent);

    await submitted.agent
      .post("/api/daily-updates")
      .send({ crmProjectId: crmProject.id, status: "on_track" });

    const res = await admin.agent.get("/api/admin/daily-updates/today-status");
    expect(res.status).toBe(200);
    expect(res.body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(res.body.submitted.map((u: { id: string }) => u.id)).toEqual([submitted.id]);
    expect(res.body.missing.map((u: { id: string }) => u.id)).toEqual([missing.id]);
    // Quirk: admins are excluded from both lists — the roll-call covers the
    // "user" role only.
    const everyone = [...res.body.submitted, ...res.body.missing].map((u: { id: string }) => u.id);
    expect(everyone).not.toContain(admin.id);
    // Only display fields are exposed.
    expect(Object.keys(res.body.submitted[0]).sort()).toEqual(
      ["email", "firstName", "id", "lastName", "profileImageUrl"].sort()
    );
  });
});

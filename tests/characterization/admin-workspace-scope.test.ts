import { describe, it, expect, beforeEach } from "vitest";
import { PARALLEL_WORKSPACE_ID } from "@shared/schema";
import { makeApp } from "../helpers/app";
import { resetDb } from "../helpers/db";
import { registerAdmin } from "../helpers/auth";
import { createCrmProject, createTask, startTimer } from "../helpers/fixtures";
import { addWorkspaceMembership, plantParallelWorkspace } from "../helpers/workspace";

/**
 * Workspace scope on the operator reads (ADR-0006, ADR-0017 phase 4).
 *
 * These routes read tables that carry `workspace_id` but have no row-level
 * security yet, so the scope has to come from the query. Until it does, the
 * legacy global-admin gate is the only thing standing between one Workspace's
 * operator and another Workspace's records, which is not a seam anyone should
 * be relying on.
 *
 * The subject here is one Administrator with a Membership in two Workspaces.
 * Switching the Active Workspace must change what these reads return; the
 * authorization gate is deliberately not the variable under test.
 */
describe("operator reads stay inside the Active Workspace", () => {
  beforeEach(async () => {
    await resetDb();
  });

  async function adminInTwoWorkspaces(app: Awaited<ReturnType<typeof makeApp>>) {
    const admin = await registerAdmin(app, { firstName: "Ada", lastName: "Byron" });
    await plantParallelWorkspace();
    await addWorkspaceMembership(admin.id, PARALLEL_WORKSPACE_ID, "administrator");
    return admin;
  }

  async function switchTo(
    admin: Awaited<ReturnType<typeof registerAdmin>>,
    workspaceId: string,
  ): Promise<void> {
    const res = await admin.agent.put("/api/memberships/active").send({ workspaceId });
    expect(res.status).toBe(200);
    expect(res.body.activeWorkspaceId).toBe(workspaceId);
  }

  it("does not report another Workspace's tracked time", async () => {
    const app = await makeApp();
    const admin = await adminInTwoWorkspaces(app);

    const project = await createCrmProject(admin.agent, { name: "Keystone" });
    const task = await createTask(admin.agent, project.crmProject.id);
    const timer = await startTimer(admin.agent, project.crmProject.id, task.id);
    await admin.agent.post(`/api/time-tracking/${timer.id}/stop`);

    const inSeeded = await admin.agent.get("/api/admin/analytics/overview");
    expect(inSeeded.status).toBe(200);
    expect(inSeeded.body.entriesCount).toBeGreaterThan(0);

    await switchTo(admin, PARALLEL_WORKSPACE_ID);

    const overview = await admin.agent.get("/api/admin/analytics/overview");
    expect(overview.status).toBe(200);
    expect(overview.body.entriesCount).toBe(0);
    expect(overview.body.totalTrackedSeconds).toBe(0);

    const activity = await admin.agent.get("/api/admin/analytics/activity");
    expect(activity.status).toBe(200);
    expect(activity.body.byUser).toEqual([]);

    const coverage = await admin.agent.get("/api/admin/analytics/coverage");
    expect(coverage.status).toBe(200);
    expect(coverage.body.summary.totalEntries).toBe(0);
    expect(coverage.body.byUser).toEqual([]);
  });

  it("exports only the Active Workspace, which the scoped read already did", async () => {
    const app = await makeApp();
    const admin = await adminInTwoWorkspaces(app);

    const project = await createCrmProject(admin.agent, { name: "Keystone" });
    const task = await createTask(admin.agent, project.crmProject.id);
    const timer = await startTimer(admin.agent, project.crmProject.id, task.id);
    await admin.agent.post(`/api/time-tracking/${timer.id}/stop`);

    await switchTo(admin, PARALLEL_WORKSPACE_ID);

    const csv = await admin.agent.get("/api/admin/analytics/export");
    expect(csv.status).toBe(200);
    expect(csv.text.trim().split("\n")).toHaveLength(1);
    expect(csv.text).not.toContain("Keystone");
  });

  it("does not list another Workspace's CRM modules or fields", async () => {
    const app = await makeApp();
    const admin = await adminInTwoWorkspaces(app);

    const created = await admin.agent
      .post("/api/admin/modules")
      .send({ name: "Vessels", slug: "vessels", description: "Keystone only" });
    expect(created.status).toBe(201);
    const moduleId = created.body.id;

    const field = await admin.agent
      .post(`/api/admin/modules/${moduleId}/fields`)
      .send({ name: "Tonnage", slug: "tonnage", fieldType: "text" });
    expect(field.status).toBe(201);

    await switchTo(admin, PARALLEL_WORKSPACE_ID);

    const modules = await admin.agent.get("/api/admin/modules");
    expect(modules.status).toBe(200);
    expect(modules.body).toEqual([]);

    const one = await admin.agent.get(`/api/admin/modules/${moduleId}`);
    expect(one.status).toBe(404);

    const fields = await admin.agent.get(`/api/admin/modules/${moduleId}/fields`);
    expect(fields.status === 404 || JSON.stringify(fields.body) === "[]").toBe(true);
  });

  it("keeps each Workspace's Tracking Policy its own", async () => {
    const app = await makeApp();
    const admin = await adminInTwoWorkspaces(app);

    const saved = await admin.agent
      .patch("/api/admin/org-settings")
      .send({ screenshotPolicy: { captureIntervalMinMin: 7, captureIntervalMaxMin: 9 } });
    expect(saved.status).toBe(200);

    await switchTo(admin, PARALLEL_WORKSPACE_ID);

    const other = await admin.agent.get("/api/admin/org-settings");
    expect(other.status).toBe(200);
    expect(other.body.screenshotPolicy.captureIntervalMinMin).toBe(3);
    expect(other.body.screenshotPolicy.captureIntervalMaxMin).toBe(5);

    // Saving here must not reach back into the Workspace that set 7–9.
    const savedOther = await admin.agent
      .patch("/api/admin/org-settings")
      .send({ screenshotPolicy: { captureIntervalMinMin: 4, captureIntervalMaxMin: 6 } });
    expect(savedOther.status).toBe(200);

    await switchTo(admin, "seeded");

    const back = await admin.agent.get("/api/admin/org-settings");
    expect(back.status).toBe(200);
    expect(back.body.screenshotPolicy.captureIntervalMinMin).toBe(7);
    expect(back.body.screenshotPolicy.captureIntervalMaxMin).toBe(9);
  });

  it("keeps each Workspace's Screencasts timezone list its own", async () => {
    const app = await makeApp();
    const admin = await adminInTwoWorkspaces(app);

    await admin.agent
      .patch("/api/admin/org-settings")
      .send({ allowedTimezones: ["Europe/Paris"] });

    await switchTo(admin, PARALLEL_WORKSPACE_ID);

    const other = await admin.agent.get("/api/admin/org-settings");
    expect(other.status).toBe(200);
    expect(other.body.allowedTimezones ?? []).toEqual([]);
  });
});

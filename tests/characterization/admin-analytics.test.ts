import { describe, it, expect, beforeEach } from "vitest";
import { makeApp } from "../helpers/app";
import { resetDb } from "../helpers/db";
import { registerAdmin, registerUser } from "../helpers/auth";
import { createCrmProject, createTask, startTimer } from "../helpers/fixtures";

/**
 * Characterization: the admin analytics dashboards and the CSV export.
 *
 * Quirks frozen here:
 *  - Every analytics route is admin-only and defaults to the last seven days
 *    when no range is given.
 *  - The reports are observational: none of them modifies tracked time.
 *  - The export is a CSV body with a fixed seven-column header, covering
 *    stopped entries only, and names the file after the range start.
 *  - Durations in the export are hours to two decimals; the CSV quotes the text
 *    columns and doubles embedded quotes.
 */
describe("admin analytics (characterization)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  const ROUTES = [
    "/api/admin/analytics/overview",
    "/api/admin/analytics/productivity",
    "/api/admin/analytics/activity",
    "/api/admin/analytics/screenshots",
    "/api/admin/analytics/alerts",
    "/api/admin/analytics/data-quality",
    "/api/admin/analytics/coverage",
    "/api/admin/analytics/evidence-quality",
    "/api/admin/analytics/devices",
    "/api/admin/analytics/export",
  ];

  it("keeps every analytics route admin-only", async () => {
    const app = await makeApp();
    const member = await registerUser(app);

    for (const route of ROUTES) {
      const res = await member.agent.get(route);
      expect(res.status, route).toBe(403);
      expect(res.body, route).toEqual({ message: "Access denied" });
    }
  });

  it("answers every dashboard on an empty database", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);

    const overview = await admin.agent.get("/api/admin/analytics/overview");
    expect(overview.status).toBe(200);
    expect(overview.body).toEqual({
      totalTrackedSeconds: 0,
      totalIdleSeconds: 0,
      entriesCount: 0,
      runningNow: 0,
      activeUsersToday: 0,
      screenshotsInWindow: 0,
      lowActivityEntries: 0,
      revokedDevices: 0,
    });

    const alerts = await admin.agent.get("/api/admin/analytics/alerts");
    expect(alerts.status).toBe(200);
    expect(alerts.body).toEqual({
      highIdleUsers: [],
      stalledDevices: [],
      runningWithoutScreenshots: [],
    });

    const devices = await admin.agent.get("/api/admin/analytics/devices");
    expect(devices.status).toBe(200);
    expect(devices.body).toEqual([]);

    for (const route of [
      "/api/admin/analytics/productivity",
      "/api/admin/analytics/activity",
      "/api/admin/analytics/screenshots",
      "/api/admin/analytics/data-quality",
      "/api/admin/analytics/coverage",
      "/api/admin/analytics/evidence-quality",
    ]) {
      const res = await admin.agent.get(route);
      expect(res.status, route).toBe(200);
      expect(typeof res.body, route).toBe("object");
    }
  });

  it("counts a running entry in the overview and leaves it out of the export", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app, { firstName: "Ada", lastName: "Admin" });
    const { crmProject } = await createCrmProject(admin.agent, { name: "Analytics Project" });
    const task = await createTask(admin.agent, crmProject.id, "Analysis");

    const stopped = await startTimer(admin.agent, crmProject.id, task.id, 'said "hello"');
    await admin.agent.post(`/api/time-tracking/${stopped.id}/stop`);
    await startTimer(admin.agent, crmProject.id, task.id, "still going");

    const overview = await admin.agent.get("/api/admin/analytics/overview");
    expect(overview.body.entriesCount).toBe(1);
    expect(overview.body.runningNow).toBe(1);
    expect(overview.body.activeUsersToday).toBe(1);

    const exported = await admin.agent.get("/api/admin/analytics/export");
    expect(exported.status).toBe(200);
    expect(exported.headers["content-type"]).toContain("text/csv");
    expect(exported.headers["content-disposition"]).toMatch(
      /^attachment; filename="docuflow-export-\d{4}-\d{2}-\d{2}\.csv"$/
    );

    const rows = exported.text.split("\n");
    expect(rows[0]).toBe("Date,User,Project,Task,Description,Duration (h),Idle (h)");
    // Only the stopped entry is exported.
    expect(rows).toHaveLength(2);
    const columns = rows[1].split(",");
    expect(columns[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(rows[1]).toContain('"Ada Admin"');
    expect(rows[1]).toContain('"Analytics Project"');
    expect(rows[1]).toContain('"Analysis"');
    // Embedded quotes are doubled, CSV-style.
    expect(rows[1]).toContain('"said ""hello"""');
    expect(rows[1].endsWith("0.00,0.00")).toBe(true);
  });

  it("honours an explicit date range and a user filter", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);
    const member = await registerUser(app);
    const { crmProject } = await createCrmProject(admin.agent);
    const task = await createTask(admin.agent, crmProject.id);
    const entry = await startTimer(member.agent, crmProject.id, task.id);
    await member.agent.post(`/api/time-tracking/${entry.id}/stop`);

    const inRange = await admin.agent
      .get("/api/admin/analytics/export")
      .query({ start: "2020-01-01T00:00:00.000Z" });
    expect(inRange.headers["content-disposition"]).toContain("docuflow-export-2020-01-01.csv");
    expect(inRange.text.split("\n")).toHaveLength(2);

    // A window that ended before the entry started excludes it.
    const outOfRange = await admin.agent.get("/api/admin/analytics/export").query({
      start: "2020-01-01T00:00:00.000Z",
      end: "2020-01-08T00:00:00.000Z",
    });
    expect(outOfRange.text.split("\n")).toHaveLength(1);

    const otherUser = await admin.agent
      .get("/api/admin/analytics/export")
      .query({ userId: admin.id });
    expect(otherUser.text.split("\n")).toHaveLength(1);

    const forMember = await admin.agent
      .get("/api/admin/analytics/export")
      .query({ userId: member.id });
    expect(forMember.text.split("\n")).toHaveLength(2);
  });
});

import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  CLIENTS_READ_CAPABILITY_ID,
  CLIENTS_WRITE_CAPABILITY_ID,
  PROJECTS_READ_CAPABILITY_ID,
  TIME_ENTRIES_READ_CAPABILITY_ID,
  memberships,
  workspaces,
  workspaceRoles,
} from "../../shared/schema";
import { makeApp } from "../helpers/app";
import { newAgent, registerUser, setWorkspaceRole } from "../helpers/auth";
import { resetDb } from "../helpers/db";
import { createClient, createCrmProject, createTask, startTimer } from "../helpers/fixtures";

/**
 * Phase 7 ticket #127: first public `/api/v1` catalogue. The seam is HTTP
 * `/api/v1` against disposable Postgres. Capability denial is 403. Another
 * Workspace's ids fail closed. Pagination is cursor-only. Create Client is
 * the Idempotency-Key tracer.
 */

const TRACEPARENT =
  "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01";
const TRACE_ID = "0af7651916cd43dd8448eb211c80319c";
const OTHER_WORKSPACE_ID = "other";
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

async function plantOtherWorkspace() {
  const { db } = await import("../../server/db");
  await db.insert(workspaces).values({ id: OTHER_WORKSPACE_ID, name: "Other" });
  await db.insert(workspaceRoles).values({
    id: "other-member",
    workspaceId: OTHER_WORKSPACE_ID,
    slug: "member",
    name: "Member",
  });
}

async function serviceAccountAgent(
  app: Awaited<ReturnType<typeof makeApp>>,
  capabilityIds: string[]
) {
  const admin = await registerUser(app);
  await setWorkspaceRole(admin.id, "owner");
  const created = await admin.agent
    .post("/api/service-accounts")
    .send({ name: "CRM", capabilityIds });
  expect(created.status).toBe(201);
  const agent = newAgent(app).set("Authorization", `Bearer ${created.body.plaintextKey}`);
  return { admin, agent };
}

describe("public /api/v1 catalogue — Clients", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("returns 403 when the Service Account lacks clients_read", async () => {
    const app = await makeApp();
    const { agent } = await serviceAccountAgent(app, []);

    const res = await agent.get("/api/v1/clients").set("traceparent", TRACEPARENT);

    expect(res.status).toBe(403);
    expect(res.headers["content-type"]).toMatch(/application\/problem\+json/);
    expect(res.body).toEqual({
      type: "urn:docuflow:problem:forbidden",
      title: "Forbidden",
      status: 403,
      requestId: TRACE_ID,
    });
  });

  it("lists and gets Clients in its Workspace as a cursor page", async () => {
    const app = await makeApp();
    const { admin, agent } = await serviceAccountAgent(app, [CLIENTS_READ_CAPABILITY_ID]);
    const acme = await createClient(admin.agent, { name: "Acme", company: "Acme Ltd" });

    const list = await agent.get("/api/v1/clients");
    expect(list.status).toBe(200);
    expect(list.body.nextCursor).toBeNull();
    expect(list.body.data).toEqual([
      {
        id: acme.id,
        name: "Acme",
        company: "Acme Ltd",
        email: null,
        phone: null,
        status: "lead",
        createdAt: expect.stringMatching(RFC3339),
        updatedAt: expect.stringMatching(RFC3339),
      },
    ]);
    expect(list.body.data[0]).not.toHaveProperty("ownerId");
    expect(list.body.data[0]).not.toHaveProperty("workspaceId");

    const got = await agent.get(`/api/v1/clients/${acme.id}`);
    expect(got.status).toBe(200);
    expect(got.body).toEqual(list.body.data[0]);
  });

  it("pages Clients with an opaque cursor, never an offset", async () => {
    const app = await makeApp();
    const { admin, agent } = await serviceAccountAgent(app, [CLIENTS_READ_CAPABILITY_ID]);
    await createClient(admin.agent, { name: "Alpha" });
    await createClient(admin.agent, { name: "Beta" });
    await createClient(admin.agent, { name: "Gamma" });

    const first = await agent.get("/api/v1/clients").query({ limit: 2 });
    expect(first.status).toBe(200);
    expect(first.body.data.map((row: { name: string }) => row.name)).toEqual(["Alpha", "Beta"]);
    expect(typeof first.body.nextCursor).toBe("string");
    expect(first.body.nextCursor).not.toMatch(/offset/i);
    expect(first.body.nextCursor).not.toMatch(/^\d+$/);

    const second = await agent
      .get("/api/v1/clients")
      .query({ cursor: first.body.nextCursor, limit: 2 });
    expect(second.status).toBe(200);
    expect(second.body.data.map((row: { name: string }) => row.name)).toEqual(["Gamma"]);
    expect(second.body.nextCursor).toBeNull();
  });

  it("fails closed on another Workspace's Client id", async () => {
    const app = await makeApp();
    const { storage } = await import("../../server/storage");
    const { runWithWorkspaceContext } = await import("../../server/workspaceContext");
    const { db } = await import("../../server/db");

    await plantOtherWorkspace();
    const other = await storage.createUser({
      email: "other@test.invalid",
      password: "not-a-real-hash",
      firstName: "Other",
    });
    await db.delete(memberships).where(eq(memberships.userId, other.id));
    await db.insert(memberships).values({
      workspaceId: OTHER_WORKSPACE_ID,
      userId: other.id,
      workspaceRoleId: "other-member",
    });
    const theirs = await runWithWorkspaceContext({ workspaceId: OTHER_WORKSPACE_ID }, () =>
      storage.createCrmClient({ name: "Theirs", ownerId: other.id })
    );

    const { agent } = await serviceAccountAgent(app, [CLIENTS_READ_CAPABILITY_ID]);
    const res = await agent.get(`/api/v1/clients/${theirs.id}`).set("traceparent", TRACEPARENT);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      type: "urn:docuflow:problem:not-found",
      title: "Not Found",
      status: 404,
      requestId: TRACE_ID,
    });

    const list = await agent.get("/api/v1/clients");
    expect(list.body.data.map((row: { id: string }) => row.id)).not.toContain(theirs.id);
  });

  it("returns 403 when the Service Account lacks clients_write", async () => {
    const app = await makeApp();
    const { agent } = await serviceAccountAgent(app, [CLIENTS_READ_CAPABILITY_ID]);

    const res = await agent
      .post("/api/v1/clients")
      .set("traceparent", TRACEPARENT)
      .send({ name: "Acme" });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      type: "urn:docuflow:problem:forbidden",
      title: "Forbidden",
      status: 403,
      requestId: TRACE_ID,
    });
  });

  it("creates a Client and replays the first row for a duplicate Idempotency-Key", async () => {
    const app = await makeApp();
    const { agent } = await serviceAccountAgent(app, [
      CLIENTS_READ_CAPABILITY_ID,
      CLIENTS_WRITE_CAPABILITY_ID,
    ]);

    const first = await agent
      .post("/api/v1/clients")
      .set("Idempotency-Key", "create-client-1")
      .send({ name: "Acme" });
    const second = await agent
      .post("/api/v1/clients")
      .set("Idempotency-Key", "create-client-1")
      .send({ name: "Acme" });

    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({
      id: expect.any(String),
      name: "Acme",
      status: "lead",
      company: null,
      createdAt: expect.stringMatching(RFC3339),
    });
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);

    const list = await agent.get("/api/v1/clients");
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].id).toBe(first.body.id);
  });
});

describe("public /api/v1 catalogue — Projects", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("returns 403 when the Service Account lacks projects_read", async () => {
    const app = await makeApp();
    const { agent } = await serviceAccountAgent(app, [CLIENTS_READ_CAPABILITY_ID]);
    const res = await agent.get("/api/v1/projects").set("traceparent", TRACEPARENT);
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      type: "urn:docuflow:problem:forbidden",
      status: 403,
      requestId: TRACE_ID,
    });
  });

  it("lists and gets Projects in its Workspace", async () => {
    const app = await makeApp();
    const { admin, agent } = await serviceAccountAgent(app, [PROJECTS_READ_CAPABILITY_ID]);
    const client = await createClient(admin.agent, { name: "Acme" });
    const created = await createCrmProject(admin.agent, {
      name: "Website",
      clientId: client.id,
    });

    const list = await agent.get("/api/v1/projects");
    expect(list.status).toBe(200);
    expect(list.body.nextCursor).toBeNull();
    expect(list.body.data).toEqual([
      {
        id: created.crmProject.id,
        name: "Website",
        clientId: client.id,
        status: "planned",
        createdAt: expect.stringMatching(RFC3339),
        updatedAt: expect.stringMatching(RFC3339),
      },
    ]);

    const got = await agent.get(`/api/v1/projects/${created.crmProject.id}`);
    expect(got.status).toBe(200);
    expect(got.body).toEqual(list.body.data[0]);
  });

  it("fails closed on another Workspace's Project id", async () => {
    const app = await makeApp();
    const { storage } = await import("../../server/storage");
    const { runWithWorkspaceContext } = await import("../../server/workspaceContext");
    const { db } = await import("../../server/db");

    await plantOtherWorkspace();
    const other = await storage.createUser({
      email: "other-proj@test.invalid",
      password: "not-a-real-hash",
      firstName: "Other",
    });
    await db.delete(memberships).where(eq(memberships.userId, other.id));
    await db.insert(memberships).values({
      workspaceId: OTHER_WORKSPACE_ID,
      userId: other.id,
      workspaceRoleId: "other-member",
    });
    const theirs = await runWithWorkspaceContext({ workspaceId: OTHER_WORKSPACE_ID }, () =>
      storage.createCrmProjectWithBase({ name: "Theirs", ownerId: other.id })
    );

    const { agent } = await serviceAccountAgent(app, [PROJECTS_READ_CAPABILITY_ID]);
    const res = await agent
      .get(`/api/v1/projects/${theirs.crmProject.id}`)
      .set("traceparent", TRACEPARENT);
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({
      type: "urn:docuflow:problem:not-found",
      status: 404,
    });
  });
});

describe("public /api/v1 catalogue — Time Entries", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("returns 403 when the Service Account lacks time_entries_read", async () => {
    const app = await makeApp();
    const { agent } = await serviceAccountAgent(app, [PROJECTS_READ_CAPABILITY_ID]);
    const res = await agent.get("/api/v1/time-entries").set("traceparent", TRACEPARENT);
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      type: "urn:docuflow:problem:forbidden",
      status: 403,
    });
  });

  it("lists and gets Time Entries in its Workspace", async () => {
    const app = await makeApp();
    const { admin, agent } = await serviceAccountAgent(app, [TIME_ENTRIES_READ_CAPABILITY_ID]);
    const { crmProject } = await createCrmProject(admin.agent, { name: "Billable" });
    const task = await createTask(admin.agent, crmProject.id);
    const entry = await startTimer(admin.agent, crmProject.id, task.id, "Kickoff");

    const list = await agent.get("/api/v1/time-entries");
    expect(list.status).toBe(200);
    expect(list.body.nextCursor).toBeNull();
    expect(list.body.data).toEqual([
      {
        id: entry.id,
        projectId: crmProject.id,
        taskId: task.id,
        userId: admin.id,
        description: "Kickoff",
        startTime: expect.stringMatching(RFC3339),
        endTime: null,
        status: "running",
        duration: 0,
      },
    ]);

    const got = await agent.get(`/api/v1/time-entries/${entry.id}`);
    expect(got.status).toBe(200);
    expect(got.body).toEqual(list.body.data[0]);
  });

  it("fails closed on another Workspace's Time Entry id", async () => {
    const app = await makeApp();
    const { storage } = await import("../../server/storage");
    const { runWithWorkspaceContext } = await import("../../server/workspaceContext");
    const { db } = await import("../../server/db");

    await plantOtherWorkspace();
    const other = await storage.createUser({
      email: "other-time@test.invalid",
      password: "not-a-real-hash",
      firstName: "Other",
    });
    await db.delete(memberships).where(eq(memberships.userId, other.id));
    await db.insert(memberships).values({
      workspaceId: OTHER_WORKSPACE_ID,
      userId: other.id,
      workspaceRoleId: "other-member",
    });
    const theirs = await runWithWorkspaceContext({ workspaceId: OTHER_WORKSPACE_ID }, async () => {
      const project = await storage.createCrmProjectWithBase({ name: "Theirs", ownerId: other.id });
      return storage.createTimeEntry({
        userId: other.id,
        crmProjectId: project.crmProject.id,
        startTime: new Date("2026-08-21T12:00:00.000Z"),
        status: "stopped",
        duration: 60,
      });
    });

    const { agent } = await serviceAccountAgent(app, [TIME_ENTRIES_READ_CAPABILITY_ID]);
    const res = await agent.get(`/api/v1/time-entries/${theirs.id}`).set("traceparent", TRACEPARENT);
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({
      type: "urn:docuflow:problem:not-found",
      status: 404,
    });
  });
});

describe("public /api/v1 catalogue — out of scope", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("does not expose Activity Evidence, Documents, Files, or Opportunities", async () => {
    const app = await makeApp();
    const { agent } = await serviceAccountAgent(app, [
      CLIENTS_READ_CAPABILITY_ID,
      CLIENTS_WRITE_CAPABILITY_ID,
      PROJECTS_READ_CAPABILITY_ID,
      TIME_ENTRIES_READ_CAPABILITY_ID,
    ]);

    for (const path of [
      "/api/v1/opportunities",
      "/api/v1/documents",
      "/api/v1/files",
      "/api/v1/activity",
      "/api/v1/activity-evidence",
      "/api/v1/search",
      "/api/v1/ai",
    ]) {
      const res = await agent.get(path).set("traceparent", TRACEPARENT);
      expect(res.status, path).toBe(404);
      expect(res.headers["content-type"]).toMatch(/application\/problem\+json/);
      expect(res.body).toEqual({
        type: "urn:docuflow:problem:not-found",
        title: "Not Found",
        status: 404,
        requestId: TRACE_ID,
      });
    }
  });
});

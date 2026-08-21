import { beforeEach, describe, expect, it } from "vitest";
import { makeApp } from "../helpers/app";
import { newAgent, registerUser, setWorkspaceRole } from "../helpers/auth";
import { resetDb } from "../helpers/db";

/**
 * Characterization: freeze the public `/api/v1` kernel contract (#126,
 * ADR-0011). New characterization only for this surface — `/api/*` and
 * `/api/agent/*` stay on their existing files.
 *
 * Quirks frozen here:
 *  - Unauthenticated `/api/v1` is 401 `application/problem+json`, never the
 *    web BFF `{ message: "Unauthorized" }` shape.
 *  - Session cookies are ignored. The authenticator is `Authorization: Bearer`
 *    with a Service Account API key.
 *  - `GET /api/v1` is the additive-only kernel root `{ version: "v1" }`.
 *    v1 does not send `Deprecation` or `Sunset`.
 *  - The IP global limiter on `/api/` does not apply; 429s are token buckets
 *    per Service Account and per Workspace (see smoke).
 */

describe("public /api/v1 (characterization)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("fails closed with RFC 9457 rather than the web { message } body", async () => {
    const app = await makeApp();
    const res = await newAgent(app).get("/api/v1");
    expect(res.status).toBe(401);
    expect(res.headers["content-type"]).toMatch(/application\/problem\+json/);
    expect(res.body).toEqual({
      type: "urn:docuflow:problem:unauthorized",
      title: "Unauthorized",
      status: 401,
      requestId: expect.stringMatching(/^[0-9a-f]{32}$/),
    });
    expect(res.body).not.toHaveProperty("message");
  });

  it("ignores a session cookie and authenticates only a Service Account Bearer key", async () => {
    const app = await makeApp();
    const admin = await registerUser(app);
    await setWorkspaceRole(admin.id, "owner");
    const created = await admin.agent.post("/api/service-accounts").send({ name: "CRM" });
    expect(created.status).toBe(201);

    const asSession = await admin.agent.get("/api/v1");
    expect(asSession.status).toBe(401);

    const asKey = await newAgent(app)
      .get("/api/v1")
      .set("Authorization", `Bearer ${created.body.plaintextKey}`);
    expect(asKey.status).toBe(200);
    expect(asKey.body).toEqual({ version: "v1" });
    expect(asKey.headers.deprecation).toBeUndefined();
    expect(asKey.headers.sunset).toBeUndefined();
    expect(asKey.headers["content-type"]).toMatch(/application\/json/);
  });
});

describe("public /api/v1 catalogue (characterization)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("lists Clients as a cursor page and 403s without the Capability", async () => {
    const { CLIENTS_READ_CAPABILITY_ID } = await import("../../shared/schema");
    const app = await makeApp();
    const admin = await registerUser(app);
    await setWorkspaceRole(admin.id, "owner");
    const granted = await admin.agent.post("/api/service-accounts").send({
      name: "CRM",
      capabilityIds: [CLIENTS_READ_CAPABILITY_ID],
    });
    const denied = await admin.agent.post("/api/service-accounts").send({ name: "No caps" });

    const asGranted = await newAgent(app)
      .get("/api/v1/clients")
      .set("Authorization", `Bearer ${granted.body.plaintextKey}`);
    expect(asGranted.status).toBe(200);
    expect(asGranted.body).toEqual({ data: [], nextCursor: null });
    expect(asGranted.body).not.toHaveProperty("page");
    expect(asGranted.body).not.toHaveProperty("total");

    const asDenied = await newAgent(app)
      .get("/api/v1/clients")
      .set("Authorization", `Bearer ${denied.body.plaintextKey}`);
    expect(asDenied.status).toBe(403);
    expect(asDenied.headers["content-type"]).toMatch(/application\/problem\+json/);
    expect(asDenied.body).not.toHaveProperty("message");
    expect(asDenied.body).toMatchObject({
      type: "urn:docuflow:problem:forbidden",
      status: 403,
    });
  });

  it("creates a Client through /api/v1 and lists Projects and Time Entries as cursor pages", async () => {
    const {
      CLIENTS_READ_CAPABILITY_ID,
      CLIENTS_WRITE_CAPABILITY_ID,
      PROJECTS_READ_CAPABILITY_ID,
      TIME_ENTRIES_READ_CAPABILITY_ID,
    } = await import("../../shared/schema");
    const { createCrmProject, createTask, startTimer } = await import("../helpers/fixtures");
    const app = await makeApp();
    const admin = await registerUser(app);
    await setWorkspaceRole(admin.id, "owner");
    const created = await admin.agent.post("/api/service-accounts").send({
      name: "CRM",
      capabilityIds: [
        CLIENTS_READ_CAPABILITY_ID,
        CLIENTS_WRITE_CAPABILITY_ID,
        PROJECTS_READ_CAPABILITY_ID,
        TIME_ENTRIES_READ_CAPABILITY_ID,
      ],
    });
    const agent = newAgent(app).set("Authorization", `Bearer ${created.body.plaintextKey}`);

    const first = await agent.post("/api/v1/clients").set("Idempotency-Key", "acme").send({ name: "Acme" });
    const replay = await agent.post("/api/v1/clients").set("Idempotency-Key", "acme").send({ name: "Acme" });
    expect(first.status).toBe(201);
    expect(first.body).not.toHaveProperty("ownerId");
    expect(replay.body).toEqual(first.body);

    await createCrmProject(admin.agent, { name: "Website" });
    const { crmProject } = await createCrmProject(admin.agent, { name: "App" });
    const task = await createTask(admin.agent, crmProject.id);
    await startTimer(admin.agent, crmProject.id, task.id);

    const projects = await agent.get("/api/v1/projects");
    expect(projects.status).toBe(200);
    expect(projects.body).toEqual({
      data: expect.any(Array),
      nextCursor: null,
    });
    expect(projects.body.data.length).toBe(2);
    expect(projects.body).not.toHaveProperty("page");

    const entries = await agent.get("/api/v1/time-entries");
    expect(entries.status).toBe(200);
    expect(entries.body).toEqual({
      data: expect.any(Array),
      nextCursor: null,
    });
    expect(entries.body.data).toHaveLength(1);
    expect(entries.body.data[0]).toMatchObject({ projectId: crmProject.id, status: "running" });
    expect(entries.body.data[0]).not.toHaveProperty("crmProjectId");
  });

  it("does not reach Opportunities, Documents, Files, or Activity Evidence", async () => {
    const app = await makeApp();
    const admin = await registerUser(app);
    await setWorkspaceRole(admin.id, "owner");
    const created = await admin.agent.post("/api/service-accounts").send({ name: "CRM" });
    const agent = newAgent(app).set("Authorization", `Bearer ${created.body.plaintextKey}`);

    for (const path of [
      "/api/v1/opportunities",
      "/api/v1/documents",
      "/api/v1/files",
      "/api/v1/activity",
      "/api/v1/search",
      "/api/v1/ai",
    ]) {
      const res = await agent.get(path);
      expect(res.status, path).toBe(404);
      expect(res.body).not.toHaveProperty("message");
      expect(res.body).toMatchObject({ type: "urn:docuflow:problem:not-found", status: 404 });
    }
  });
});

describe("public /api/v1 webhook endpoints (characterization)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("lets a Service Account with capability create, list, get, disable, and rotate", async () => {
    const { WEBHOOK_ENDPOINTS_MANAGE_CAPABILITY_ID } = await import("../../shared/schema");
    const app = await makeApp();
    const admin = await registerUser(app);
    await setWorkspaceRole(admin.id, "owner");
    const created = await admin.agent.post("/api/service-accounts").send({
      name: "Hooks",
      capabilityIds: [WEBHOOK_ENDPOINTS_MANAGE_CAPABILITY_ID],
    });
    const agent = newAgent(app).set("Authorization", `Bearer ${created.body.plaintextKey}`);

    const endpoint = await agent.post("/api/v1/webhook-endpoints").send({
      url: "https://hooks.example.test/crm",
      eventTypes: ["client.created", "client.updated"],
    });
    expect(endpoint.status).toBe(201);
    expect(endpoint.body).toMatchObject({
      url: "https://hooks.example.test/crm",
      eventTypes: ["client.created", "client.updated"],
      disabledAt: null,
    });
    expect(typeof endpoint.body.plaintextSecret).toBe("string");
    expect(endpoint.body).not.toHaveProperty("hmacSecret");
    expect(endpoint.body.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const listed = await agent.get("/api/v1/webhook-endpoints");
    expect(listed.status).toBe(200);
    expect(listed.body).toEqual({
      data: [expect.objectContaining({ id: endpoint.body.id })],
      nextCursor: null,
    });
    expect(listed.body.data[0]).not.toHaveProperty("plaintextSecret");
    expect(listed.body).not.toHaveProperty("page");

    const got = await agent.get(`/api/v1/webhook-endpoints/${endpoint.body.id}`);
    expect(got.status).toBe(200);
    expect(got.body.id).toBe(endpoint.body.id);
    expect(got.body).not.toHaveProperty("plaintextSecret");

    const disabled = await agent.post(`/api/v1/webhook-endpoints/${endpoint.body.id}/disable`);
    expect(disabled.status).toBe(200);
    expect(disabled.body).toEqual({ ok: true });

    const rotated = await agent.post(`/api/v1/webhook-endpoints/${endpoint.body.id}/rotate`);
    expect(rotated.status).toBe(200);
    expect(rotated.body.plaintextSecret).not.toBe(endpoint.body.plaintextSecret);
  });

  it("returns 403 without the Capability and does not grant domain reads", async () => {
    const { WEBHOOK_ENDPOINTS_MANAGE_CAPABILITY_ID } = await import("../../shared/schema");
    const app = await makeApp();
    const admin = await registerUser(app);
    await setWorkspaceRole(admin.id, "owner");
    const denied = await admin.agent.post("/api/service-accounts").send({ name: "No caps" });
    const granted = await admin.agent.post("/api/service-accounts").send({
      name: "Hooks only",
      capabilityIds: [WEBHOOK_ENDPOINTS_MANAGE_CAPABILITY_ID],
    });

    const asDenied = await newAgent(app)
      .get("/api/v1/webhook-endpoints")
      .set("Authorization", `Bearer ${denied.body.plaintextKey}`);
    expect(asDenied.status).toBe(403);
    expect(asDenied.headers["content-type"]).toMatch(/application\/problem\+json/);
    expect(asDenied.body).not.toHaveProperty("message");
    expect(asDenied.body).toMatchObject({
      type: "urn:docuflow:problem:forbidden",
      status: 403,
    });

    const hooksOnly = newAgent(app).set("Authorization", `Bearer ${granted.body.plaintextKey}`);
    const clients = await hooksOnly.get("/api/v1/clients");
    expect(clients.status).toBe(403);
    const projects = await hooksOnly.get("/api/v1/projects");
    expect(projects.status).toBe(403);
  });

  it("rejects an event type outside the allowlist and fails closed on another Workspace's id", async () => {
    const { WEBHOOK_ENDPOINTS_MANAGE_CAPABILITY_ID, workspaces, workspaceRoles } = await import(
      "../../shared/schema"
    );
    const { runWithWorkspaceContext } = await import("../../server/workspaceContext");
    const { createWebhookEndpoint } = await import("../../server/modules/workspace");
    const app = await makeApp();
    const admin = await registerUser(app);
    await setWorkspaceRole(admin.id, "owner");
    const created = await admin.agent.post("/api/service-accounts").send({
      name: "Hooks",
      capabilityIds: [WEBHOOK_ENDPOINTS_MANAGE_CAPABILITY_ID],
    });
    const agent = newAgent(app).set("Authorization", `Bearer ${created.body.plaintextKey}`);

    const rejected = await agent.post("/api/v1/webhook-endpoints").send({
      url: "https://hooks.example.test/crm",
      eventTypes: ["invoice.paid"],
    });
    expect(rejected.status).toBe(400);
    expect(rejected.headers["content-type"]).toMatch(/application\/problem\+json/);
    expect(rejected.body).toMatchObject({ type: "urn:docuflow:problem:bad-request", status: 400 });

    const { db } = await import("../../server/db");
    await db.insert(workspaces).values({ id: "other", name: "Other" });
    await db.insert(workspaceRoles).values({
      id: "other-member",
      workspaceId: "other",
      slug: "member",
      name: "Member",
    });
    const theirs = await runWithWorkspaceContext({ workspaceId: "other" }, () =>
      createWebhookEndpoint({
        url: "https://other.example.test/hooks",
        eventTypes: ["client.created"],
      })
    );

    const leaked = await agent.get(`/api/v1/webhook-endpoints/${theirs.id}`);
    expect(leaked.status).toBe(404);
    expect(leaked.body).toMatchObject({ type: "urn:docuflow:problem:not-found", status: 404 });
  });
});


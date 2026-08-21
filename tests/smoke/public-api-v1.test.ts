import { beforeEach, describe, expect, it } from "vitest";
import { loginDevice } from "../helpers/agent";
import { makeApp } from "../helpers/app";
import { newAgent, registerUser, setWorkspaceRole } from "../helpers/auth";
import { resetDb } from "../helpers/db";

/**
 * Phase 7 ticket #126: public `/api/v1` contract kernel. The seam is HTTP
 * `/api/v1` (and cursor helpers). Web and agent characterization stay green.
 */

const TRACEPARENT =
  "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01";
const TRACE_ID = "0af7651916cd43dd8448eb211c80319c";

describe("public /api/v1 kernel", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("rejects an unauthenticated call with RFC 9457 whose requestId is the trace id", async () => {
    const app = await makeApp();
    const res = await newAgent(app).get("/api/v1").set("traceparent", TRACEPARENT);

    expect(res.status).toBe(401);
    expect(res.headers["content-type"]).toMatch(/application\/problem\+json/);
    expect(res.body).toEqual({
      type: "urn:docuflow:problem:unauthorized",
      title: "Unauthorized",
      status: 401,
      requestId: TRACE_ID,
    });
  });

  it("rejects a session cookie and a Device token", async () => {
    const app = await makeApp();
    const user = await registerUser(app);

    const asSession = await user.agent.get("/api/v1");
    expect(asSession.status).toBe(401);
    expect(asSession.body).toMatchObject({
      type: "urn:docuflow:problem:unauthorized",
      status: 401,
    });

    const device = await loginDevice(app, user);
    const asDevice = await device.request.get("/api/v1");
    expect(asDevice.status).toBe(401);
    expect(asDevice.body).toMatchObject({
      type: "urn:docuflow:problem:unauthorized",
      status: 401,
    });
  });

  it("does not accept an x-api-key on /api/v1, including a Service Account key", async () => {
    const app = await makeApp();
    const admin = await registerUser(app);
    await setWorkspaceRole(admin.id, "owner");
    const created = await admin.agent.post("/api/service-accounts").send({ name: "CRM" });

    const withHeader = await newAgent(app)
      .get("/api/v1")
      .set("x-api-key", created.body.plaintextKey);
    expect(withHeader.status).toBe(401);
    expect(withHeader.body).toMatchObject({
      type: "urn:docuflow:problem:unauthorized",
      status: 401,
    });
  });

  it("maps a valid Service Account key to PrincipalContext", async () => {
    const app = await makeApp();
    const admin = await registerUser(app);
    await setWorkspaceRole(admin.id, "owner");
    const created = await admin.agent.post("/api/service-accounts").send({ name: "CRM" });
    expect(created.status).toBe(201);

    const res = await newAgent(app)
      .get("/api/v1")
      .set("Authorization", `Bearer ${created.body.plaintextKey}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ version: "v1" });
    expect(res.headers.deprecation).toBeUndefined();
    expect(res.headers.sunset).toBeUndefined();
  });

  it("answers unknown /api/v1 paths with RFC 9457, not the web { message } shape", async () => {
    const app = await makeApp();
    const admin = await registerUser(app);
    await setWorkspaceRole(admin.id, "owner");
    const created = await admin.agent.post("/api/service-accounts").send({ name: "CRM" });

    const res = await newAgent(app)
      .get("/api/v1/does-not-exist")
      .set("Authorization", `Bearer ${created.body.plaintextKey}`)
      .set("traceparent", TRACEPARENT);

    expect(res.status).toBe(404);
    expect(res.headers["content-type"]).toMatch(/application\/problem\+json/);
    expect(res.body).toEqual({
      type: "urn:docuflow:problem:not-found",
      title: "Not Found",
      status: 404,
      requestId: TRACE_ID,
    });
    expect(res.body).not.toHaveProperty("message");
  });

  it("replays the stored first response for a duplicate Idempotency-Key", async () => {
    const app = await makeApp();
    const admin = await registerUser(app);
    await setWorkspaceRole(admin.id, "owner");
    const created = await admin.agent.post("/api/service-accounts").send({ name: "CRM" });
    const agent = newAgent(app).set("Authorization", `Bearer ${created.body.plaintextKey}`);

    const first = await agent
      .post("/api/v1")
      .set("Idempotency-Key", "create-client-1")
      .set("traceparent", TRACEPARENT)
      .send({ name: "Acme" });
    const second = await agent
      .post("/api/v1")
      .set("Idempotency-Key", "create-client-1")
      .set("traceparent", "00-11111111111111111111111111111111-b7ad6b7169203331-01")
      .send({ name: "Acme" });

    expect(first.status).toBe(404);
    expect(first.body.requestId).toBe(TRACE_ID);
    expect(second.status).toBe(first.status);
    expect(second.headers["content-type"]).toBe(first.headers["content-type"]);
    expect(second.body).toEqual(first.body);
  });

  it("does not replay an Idempotency-Key onto a different path", async () => {
    const app = await makeApp();
    const admin = await registerUser(app);
    await setWorkspaceRole(admin.id, "owner");
    const created = await admin.agent.post("/api/service-accounts").send({ name: "CRM" });
    const agent = newAgent(app).set("Authorization", `Bearer ${created.body.plaintextKey}`);

    const first = await agent
      .post("/api/v1")
      .set("Idempotency-Key", "shared-key")
      .set("traceparent", TRACEPARENT)
      .send({});
    const otherPath = await agent
      .post("/api/v1/other")
      .set("Idempotency-Key", "shared-key")
      .set("traceparent", "00-11111111111111111111111111111111-b7ad6b7169203331-01")
      .send({});

    expect(first.status).toBe(404);
    expect(otherPath.status).toBe(409);
    expect(otherPath.headers["content-type"]).toMatch(/application\/problem\+json/);
    expect(otherPath.body).toEqual({
      type: "urn:docuflow:problem:conflict",
      title: "Conflict",
      status: 409,
      requestId: "11111111111111111111111111111111",
    });
  });

  it("returns 429 when the Service Account token bucket is exceeded", async () => {
    const app = await makeApp();
    const admin = await registerUser(app);
    await setWorkspaceRole(admin.id, "owner");
    const created = await admin.agent.post("/api/service-accounts").send({ name: "CRM" });
    const agent = newAgent(app).set("Authorization", `Bearer ${created.body.plaintextKey}`);

    let lastAllowed: Awaited<ReturnType<typeof agent.get>> | undefined;
    for (let i = 0; i < 60; i++) {
      lastAllowed = await agent.get("/api/v1");
      expect(lastAllowed.status, `request ${i + 1}`).toBe(200);
    }
    expect(lastAllowed!.status).toBe(200);

    const throttled = await agent.get("/api/v1").set("traceparent", TRACEPARENT);
    expect(throttled.status).toBe(429);
    expect(throttled.headers["content-type"]).toMatch(/application\/problem\+json/);
    expect(throttled.body).toEqual({
      type: "urn:docuflow:problem:rate-limited",
      title: "Too Many Requests",
      status: 429,
      requestId: TRACE_ID,
    });
  });

  it("returns 429 when the Workspace aggregate bucket is exceeded", async () => {
    const app = await makeApp();
    const admin = await registerUser(app);
    await setWorkspaceRole(admin.id, "owner");
    const first = await admin.agent.post("/api/service-accounts").send({ name: "A" });
    const second = await admin.agent.post("/api/service-accounts").send({ name: "B" });
    const third = await admin.agent.post("/api/service-accounts").send({ name: "C" });

    const agentA = newAgent(app).set("Authorization", `Bearer ${first.body.plaintextKey}`);
    const agentB = newAgent(app).set("Authorization", `Bearer ${second.body.plaintextKey}`);
    const agentC = newAgent(app).set("Authorization", `Bearer ${third.body.plaintextKey}`);

    for (let i = 0; i < 60; i++) {
      expect((await agentA.get("/api/v1")).status, `A ${i + 1}`).toBe(200);
    }
    for (let i = 0; i < 60; i++) {
      expect((await agentB.get("/api/v1")).status, `B ${i + 1}`).toBe(200);
    }

    const throttled = await agentC.get("/api/v1");
    expect(throttled.status).toBe(429);
    expect(throttled.body).toMatchObject({
      type: "urn:docuflow:problem:rate-limited",
      status: 429,
    });
  });
});

describe("public /api/v1 cursor helpers", () => {
  it("yields an opaque next cursor or a terminal page, never an offset", async () => {
    const { cursorPage } = await import("../../server/publicApi/cursor");
    const rows = [{ id: "aaa" }, { id: "bbb" }, { id: "ccc" }];

    const page = cursorPage(rows, 2);
    expect(page.data.map((row) => row.id)).toEqual(["aaa", "bbb"]);
    expect(typeof page.nextCursor).toBe("string");
    expect(page.nextCursor).not.toMatch(/offset/i);
    expect(page.nextCursor).not.toMatch(/^\d+$/);

    const terminal = cursorPage(rows.slice(0, 2), 2);
    expect(terminal.data.map((row) => row.id)).toEqual(["aaa", "bbb"]);
    expect(terminal.nextCursor).toBeNull();
  });

  it("formats public timestamps as RFC 3339 UTC", async () => {
    const { rfc3339Utc } = await import("../../server/publicApi/cursor");
    expect(rfc3339Utc(new Date("2026-08-21T12:00:00.000Z"))).toBe("2026-08-21T12:00:00.000Z");
  });

  it("builds Deprecation and Sunset headers for a future major", async () => {
    const { deprecationHeaders } = await import("../../server/publicApi/deprecation");
    expect(deprecationHeaders(new Date("2027-08-21T00:00:00.000Z"))).toEqual({
      Deprecation: "true",
      Sunset: "Sat, 21 Aug 2027 00:00:00 GMT",
    });
  });
});

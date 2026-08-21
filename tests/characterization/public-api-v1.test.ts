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

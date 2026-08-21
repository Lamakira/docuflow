import { beforeEach, describe, expect, it } from "vitest";
import { makeApp } from "../helpers/app";
import { registerAdmin, registerUser, setWorkspaceRole } from "../helpers/auth";
import { resetDb } from "../helpers/db";

/**
 * Characterization: freeze the Webhook Endpoint web BFF (#129). New session
 * routes on `/api/webhook-endpoints`. Errors stay `{ message }`, matching
 * today's `/api/*`. Public `/api/v1` characterization is in public-api-v1.test.ts.
 */

describe("webhook endpoint web BFF (characterization)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("lets a Workspace administrator create, list, get, disable, and rotate", async () => {
    const app = await makeApp();
    const admin = await registerUser(app);
    await setWorkspaceRole(admin.id, "administrator");

    const created = await admin.agent.post("/api/webhook-endpoints").send({
      url: "https://hooks.example.test/crm",
      eventTypes: ["client.created"],
    });
    expect(created.status).toBe(201);
    expect(created.headers["content-type"]).toMatch(/application\/json/);
    expect(created.body).toMatchObject({
      url: "https://hooks.example.test/crm",
      eventTypes: ["client.created"],
      disabledAt: null,
    });
    expect(typeof created.body.plaintextSecret).toBe("string");
    expect(created.body).not.toHaveProperty("hmacSecret");
    expect(created.body).not.toHaveProperty("type");

    const listed = await admin.agent.get("/api/webhook-endpoints");
    expect(listed.status).toBe(200);
    expect(listed.body).toEqual([
      expect.objectContaining({ id: created.body.id, url: "https://hooks.example.test/crm" }),
    ]);
    expect(listed.body[0]).not.toHaveProperty("plaintextSecret");
    expect(listed.body[0]).not.toHaveProperty("hmacSecret");

    const got = await admin.agent.get(`/api/webhook-endpoints/${created.body.id}`);
    expect(got.status).toBe(200);
    expect(got.body.id).toBe(created.body.id);
    expect(got.body).not.toHaveProperty("plaintextSecret");

    const disabled = await admin.agent.post(`/api/webhook-endpoints/${created.body.id}/disable`);
    expect(disabled.status).toBe(200);
    expect(disabled.body).toEqual({ ok: true });

    const rotated = await admin.agent.post(`/api/webhook-endpoints/${created.body.id}/rotate`);
    expect(rotated.status).toBe(200);
    expect(rotated.body.plaintextSecret).not.toBe(created.body.plaintextSecret);
    expect(rotated.body).not.toHaveProperty("hmacSecret");
  });

  it("rejects a Member and a users.role admin with { message }, not problem+json", async () => {
    const app = await makeApp();
    const member = await registerUser(app);
    const platformAdmin = await registerAdmin(app);

    const asMember = await member.agent.post("/api/webhook-endpoints").send({
      url: "https://hooks.example.test/crm",
      eventTypes: ["client.created"],
    });
    expect(asMember.status).toBe(403);
    expect(asMember.body).toEqual({ message: "Access denied" });
    expect(asMember.body).not.toHaveProperty("type");

    const asPlatformAdmin = await platformAdmin.agent.get("/api/webhook-endpoints");
    expect(asPlatformAdmin.status).toBe(403);
    expect(asPlatformAdmin.body).toEqual({ message: "Access denied" });
  });

  it("rejects an event type outside the public allowlist with { message }", async () => {
    const app = await makeApp();
    const admin = await registerUser(app);
    await setWorkspaceRole(admin.id, "owner");

    const res = await admin.agent.post("/api/webhook-endpoints").send({
      url: "https://hooks.example.test/crm",
      eventTypes: ["client.deleted"],
    });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message: "Unknown webhook event type" });
    expect(res.body).not.toHaveProperty("type");
  });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * Phase 5 ticket #111: Replit OIDC, `MCP_API_KEY`, and the dual-auth flag come
 * out together (ADR-0007, ADR-0017). Clerk is the only web authentication path.
 *
 * Seam is HTTP: the same `/api/*` a browser and an old client hit. Device
 * Enrollment is asserted untouched; the agent's own token path is characterized
 * in `tests/characterization/agent-auth.test.ts`.
 *
 * Live Clerk is never reached. `vitest.config.ts` aliases `@clerk/backend` to
 * `tests/fakes/clerk.ts`, and the credentials below are that fake's.
 */

process.env.CLERK_SECRET_KEY = "sk_test_clerk-only";
process.env.CLERK_PUBLISHABLE_KEY = "pk_test_clerk-only";

import { makeApp } from "../helpers/app";
import { resetDb } from "../helpers/db";
import { makeMainAdmin, newAgent, promoteToAdmin, registerUser, uniqueEmail } from "../helpers/auth";

const DRAIN = "DOCUFLOW_IDENTITY_DUAL_AUTH";

beforeEach(async () => {
  await resetDb();
});

afterEach(() => {
  delete process.env[DRAIN];
  delete process.env.MCP_API_KEY;
  delete process.env.REPL_ID;
  delete process.env.ISSUER_URL;
});

describe("Clerk is the web session, with no drain flag (#111)", () => {
  it("lets a linked User into the Workspace with the flag unset", async () => {
    const app = await makeApp();
    const user = await registerUser(app, { email: uniqueEmail("clerk-only") });
    delete process.env[DRAIN];

    const me = await user.agent.get("/api/auth/user");
    expect(me.status).toBe(200);
    expect(me.body.id).toBe(user.id);

    const projects = await user.agent.get("/api/projects");
    expect(projects.status).toBe(200);
    expect(Array.isArray(projects.body)).toBe(true);
  });

  it("still reads a provider session when someone left the old flag off", async () => {
    const app = await makeApp();
    const user = await registerUser(app, { email: uniqueEmail("flag-off") });
    process.env[DRAIN] = "off";

    const res = await user.agent.get("/api/projects");
    expect(res.status).toBe(200);
  });

  it("serves GET /api/auth/config as enabled without the flag", async () => {
    const app = await makeApp();
    delete process.env[DRAIN];

    const res = await newAgent(app).get("/api/auth/config");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      publishableKey: "pk_test_clerk-only",
      enabled: true,
    });
  });
});

describe("Replit OIDC routes fail closed (#111)", () => {
  it("answers 410 on login, callback, and logout, even with REPL_ID set", async () => {
    const app = await makeApp();
    process.env.REPL_ID = "would-have-been-the-oidc-client";
    process.env.ISSUER_URL = "https://replit.com/oidc";

    for (const path of ["/api/login", "/api/callback", "/api/logout"]) {
      const res = await newAgent(app).get(path);
      expect(res.status, path).toBe(410);
      expect(res.body.message, path).toMatch(/Clerk/);
    }
  });

  it("establishes no session from the retired OIDC callback", async () => {
    const app = await makeApp();
    const agent = newAgent(app);

    await agent.get("/api/callback?code=anything");
    await expect(agent.get("/api/auth/user").then((res) => res.body)).resolves.toBeNull();
    const denied = await agent.get("/api/projects");
    expect(denied.status).toBe(401);
    expect(denied.body).toEqual({ message: "Unauthorized" });
  });
});

describe("X-API-Key no longer impersonates the Owner (#111)", () => {
  it("refuses a matching MCP_API_KEY on a guarded route", async () => {
    const app = await makeApp();
    const admin = await registerUser(app, { email: uniqueEmail("mcp-owner") });
    await promoteToAdmin(admin.id);
    await makeMainAdmin(admin.id);
    process.env.MCP_API_KEY = "test-mcp-key";

    const res = await newAgent(app)
      .get("/api/admin/users")
      .set("x-api-key", "test-mcp-key");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ message: "Unauthorized" });
  });
});

describe("Device Enrollment is untouched (#111)", () => {
  it("still pairs a Device through the agent's password login", async () => {
    const app = await makeApp();
    const user = await registerUser(app, { email: uniqueEmail("device") });

    const login = await newAgent(app).post("/api/agent/auth/login").send({
      email: user.email,
      password: user.password,
      deviceMeta: { deviceName: "Workstation", os: "linux", clientVersion: "0.1.0" },
    });

    expect(login.status).toBe(200);
    expect(typeof login.body.accessToken).toBe("string");

    const devices = await user.agent.get("/api/agent/devices");
    expect(devices.status).toBe(200);
    expect(devices.body.data).toHaveLength(1);
    expect(devices.body.data[0]).toMatchObject({
      id: login.body.deviceId,
      userId: user.id,
      name: "Workstation",
    });
  });
});

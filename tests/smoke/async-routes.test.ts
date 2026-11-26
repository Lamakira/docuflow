import { readFileSync } from "node:fs";
import path from "node:path";
import express from "express";
import request from "supertest";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { VIEW_DAILY_UPDATES_CAPABILITY_ID } from "../../shared/schema";
import { makeApp } from "../helpers/app";
import { registerUser, setWorkspaceRole } from "../helpers/auth";
import { ownerDb, resetDb } from "../helpers/db";

/**
 * F101: Express 4 ignores the promise an async handler returns, so a rejection
 * there used to end the process for everyone. Every route and middleware, of
 * every router, must hand it to the error handler instead.
 */

// The app's own install, not one made here: booting it is what must cover a
// router created afterwards.
async function bareApp(mount: (app: express.Express) => void) {
  await makeApp();
  const { apiErrorHandler } = await import("../../server/app");
  const app = express();
  mount(app);
  app.use(apiErrorHandler);
  return app;
}

describe("async routes (F101)", () => {
  let unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);

  beforeEach(async () => {
    await resetDb();
    unhandled = [];
    process.on("unhandledRejection", onUnhandled);
  });

  // In afterEach, not a finally: a test that times out never reaches its
  // finally, and the schema outlives this file.
  afterEach(async () => {
    process.off("unhandledRejection", onUnhandled);
    await ownerDb.execute(sql`DROP TRIGGER IF EXISTS f101_refuse ON service_accounts`);
    await ownerDb.execute(sql`DROP FUNCTION IF EXISTS f101_refuse()`);
  });

  it("answers 500 without detail when an async handler rejects, and keeps serving", async () => {
    const app = await bareApp((app) => {
      app.get("/reject", async () => {
        throw new Error("password=hunter2 at db.internal");
      });
      app.get("/fine", (_req, res) => {
        res.json({ ok: true });
      });
    });

    const refused = await request(app).get("/reject");
    expect(refused.status).toBe(500);
    expect(refused.body).toEqual({ message: "Internal Server Error" });

    const next = await request(app).get("/fine");
    expect(next.status).toBe(200);
    expect(unhandled).toEqual([]);
  });

  it("answers 500 when an async middleware rejects, in an app router and a sub-router alike", async () => {
    const app = await bareApp((app) => {
      const router = express.Router();
      router.use(async () => {
        throw new Error("middleware failed");
      });
      router.get("/x", (_req, res) => {
        res.json({ reached: true });
      });
      app.use("/sub", router);
      app.get(
        "/gated",
        async () => {
          throw new Error("gate failed");
        },
        (_req, res) => {
          res.json({ reached: true });
        },
      );
    });

    const sub = await request(app).get("/sub/x");
    expect(sub.status).toBe(500);
    expect(sub.body).toEqual({ message: "Internal Server Error" });

    const gated = await request(app).get("/gated");
    expect(gated.status).toBe(500);
    expect(gated.body).toEqual({ message: "Internal Server Error" });
    expect(unhandled).toEqual([]);
  });

  it("keeps the response already sent when a handler rejects after sending", async () => {
    const app = await bareApp((app) => {
      app.get("/sent", async (_req, res) => {
        res.json({ sent: true });
        throw new Error("after the answer");
      });
      app.get("/fine", (_req, res) => {
        res.json({ ok: true });
      });
    });

    const sent = await request(app).get("/sent");
    expect(sent.status).toBe(200);
    expect(sent.body).toEqual({ sent: true });

    const next = await request(app).get("/fine");
    expect(next.status).toBe(200);
    expect(unhandled).toEqual([]);
  });

  it("keeps a 4xx error's own message", async () => {
    const app = await bareApp((app) => {
      app.get("/teapot", async () => {
        throw Object.assign(new Error("Too large"), { status: 413 });
      });
    });

    const refused = await request(app).get("/teapot");
    expect(refused.status).toBe(413);
    expect(refused.body).toEqual({ message: "Too large" });
  });

  it("refuses a Service Account name of 300 characters with a 400", async () => {
    const app = await makeApp();
    const admin = await registerUser(app);
    await setWorkspaceRole(admin.id, "administrator");

    const refused = await admin.agent
      .post("/api/service-accounts")
      .send({ name: "x".repeat(300), capabilityIds: [VIEW_DAILY_UPDATES_CAPABILITY_ID] });
    expect(refused.status).toBe(400);
    expect(typeof refused.body.message).toBe("string");
  });

  it("answers 500 when the database refuses a write on a real route, and the next request answers", async () => {
    const app = await makeApp();
    const admin = await registerUser(app);
    await setWorkspaceRole(admin.id, "administrator");

    await ownerDb.execute(sql`
      CREATE OR REPLACE FUNCTION f101_refuse() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'simulated database failure'; END;
      $$ LANGUAGE plpgsql`);
    await ownerDb.execute(sql`
      CREATE TRIGGER f101_refuse BEFORE INSERT ON service_accounts
      FOR EACH ROW EXECUTE FUNCTION f101_refuse()`);
    const failed = await admin.agent
      .post("/api/service-accounts")
      .send({ name: "Exports", capabilityIds: [VIEW_DAILY_UPDATES_CAPABILITY_ID] });
    expect(failed.status).toBe(500);
    expect(failed.body).toEqual({ message: "Internal Server Error" });
    await ownerDb.execute(sql`DROP TRIGGER f101_refuse ON service_accounts`);

    const next = await admin.agent
      .post("/api/service-accounts")
      .send({ name: "Exports", capabilityIds: [VIEW_DAILY_UPDATES_CAPABILITY_ID] });
    expect(next.status).toBe(201);
    expect(unhandled).toEqual([]);
  });

  it("is installed by the app before any route is registered", async () => {
    await makeApp();
    const { asyncRoutesInstalled } = await import("../../server/asyncRoutes");
    expect(asyncRoutesInstalled()).toBe(true);

    const source = readFileSync(path.resolve(import.meta.dirname, "../../server/app.ts"), "utf8");
    const body = source.slice(source.indexOf("export async function createApp"));
    const installed = body.indexOf("installAsyncRoutes();");
    expect(installed).toBeGreaterThan(-1);
    expect(installed).toBeLessThan(body.indexOf("express()"));
    expect(installed).toBeLessThan(body.indexOf("registerRoutes("));
  });
});

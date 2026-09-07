import { beforeEach, describe, expect, it } from "vitest";

/**
 * Phase 9 ticket #162: leftover cookie sessions and OIDC stubs unmount
 * (ADR-0007, ADR-0017, ADR-0018).
 *
 * Seam is HTTP plus the journal. Clerk is aliased to `tests/fakes/clerk.ts`,
 * so no run reaches api.clerk.com. A web Timer Command still records an
 * origin after `req.sessionID` is gone. IdentityProvider Bearer sessions
 * still enter WorkspaceContext.
 */

import { makeApp } from "../helpers/app";
import { resetDb } from "../helpers/db";
import { registerUser } from "../helpers/auth";
import { createCrmProject, createTask, startTimer } from "../helpers/fixtures";

beforeEach(async () => {
  await resetDb();
});

describe("cookie sessions are unmounted (#162)", () => {
  it("has no sessions table in a database migrated through the journal", async () => {
    const { pool } = await import("../../server/db");
    const { rows } = await pool.query<{ tablename: string }>(
      `SELECT tablename
         FROM pg_tables
        WHERE schemaname = 'public'
          AND tablename = 'sessions'`
    );

    expect(rows).toEqual([]);
  });

  it("records a web Timer Command origin without a cookie session", async () => {
    const app = await makeApp();
    const user = await registerUser(app);
    const { crmProject } = await createCrmProject(user.agent);
    const task = await createTask(user.agent, crmProject.id);

    await startTimer(user.agent, crmProject.id, task.id);

    const { pool } = await import("../../server/db");
    const { rows } = await pool.query<{ origin: string }>(
      `SELECT origin FROM timer_commands WHERE user_id = $1 AND kind = 'start'`,
      [user.id]
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].origin).toBe(`web:${user.id}`);

    const started = await user.agent.get("/api/time-tracking/active");
    expect(started.status).toBe(200);
    expect(started.body.status).toBe("running");

    const setCookie = started.headers["set-cookie"];
    expect(setCookie?.join(" ") ?? "").not.toMatch(/connect\.sid/);
  });

  it("lets an IdentityProvider Bearer session into the Workspace", async () => {
    const app = await makeApp();
    const user = await registerUser(app);

    const me = await user.agent.get("/api/auth/user");
    expect(me.status).toBe(200);
    expect(me.body.id).toBe(user.id);

    const projects = await user.agent.get("/api/projects");
    expect(projects.status).toBe(200);
    expect(Array.isArray(projects.body)).toBe(true);
  });
});

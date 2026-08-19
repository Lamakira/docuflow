import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SEEDED_WORKSPACE_ID } from "../../shared/schema";
import { remainingWorkspaceIdNulls } from "../../scripts/verify-workspace-backfill";
import { migrate } from "../../scripts/migrate";
import { urlForDatabase, withClient } from "../helpers/db";

/**
 * Phase 4 ticket #94: nullable `workspace_id` on Workspace-owned tables, a
 * journaled SQL backfill from aggregate roots outward, Device Enrollment for
 * existing Devices, and a verifier that reports remaining nulls without
 * applying `NOT NULL`.
 *
 * HTTP is not this suite. The journal is the seam: plant legacy rows before
 * the seed, let migrate run, ask the database what it left behind. The Project
 * stamp describe below uses the harness database the same way `jobs.test.ts`
 * does — that write path cannot be observed from SQL alone.
 */

/** Last journal entry that must not seed a Workspace or stamp domain rows. */
const BEFORE_SEED = "0006_square_wild_child";

const SCRATCH_DB = "docuflow_workspace_backfill";

const GLOBAL_ALLOWLIST = [
  "users",
  "sessions",
  "desktop_releases",
  "scheduler_leases",
] as const;

/** Identity / catalog / the Workspace row itself — not stamped as owned data. */
const NOT_WORKSPACE_OWNED = [
  ...GLOBAL_ALLOWLIST,
  "workspaces",
  "capabilities",
  "devices",
  "schema_migrations",
] as const;

async function publicTables(url: string): Promise<string[]> {
  return withClient(url, async (client) => {
    const { rows } = await client.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables
        WHERE schemaname = 'public'
          AND tablename NOT LIKE '\\_\\_drizzle%'
        ORDER BY tablename`
    );
    return rows.map((row) => row.tablename);
  });
}

async function columnsNamed(url: string, table: string): Promise<string[]> {
  return withClient(url, async (client) => {
    const { rows } = await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY column_name`,
      [table]
    );
    return rows.map((row) => row.column_name);
  });
}

async function workspaceIdNullability(
  url: string
): Promise<Map<string, boolean>> {
  return withClient(url, async (client) => {
    const { rows } = await client.query<{ table_name: string; is_nullable: string }>(
      `SELECT table_name, is_nullable
         FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name = 'workspace_id'`
    );
    return new Map(rows.map((row) => [row.table_name, row.is_nullable === "YES"]));
  });
}

describe("workspace_id backfill", () => {
  let scratch: string;

  beforeAll(async () => {
    await withClient(urlForDatabase("postgres"), async (client) => {
      await client.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB}`);
      await client.query(`CREATE DATABASE ${SCRATCH_DB}`);
    });
    scratch = urlForDatabase(SCRATCH_DB);

    await migrate(scratch, { applyThrough: BEFORE_SEED });

    await withClient(scratch, async (client) => {
      await client.query(
        `INSERT INTO users (id, email, password, role, is_main_admin, created_at)
         VALUES ('u-owner', 'owner@example.test', 'x', 'admin', 1, '2020-01-01')`
      );
      await client.query(
        `INSERT INTO org_settings (id, screenshot_policy)
         VALUES ('default', '{}'::jsonb)`
      );
      await client.query(
        `INSERT INTO projects (id, name, owner_id)
         VALUES ('p-root', 'Atlas', 'u-owner')`
      );
      await client.query(
        `INSERT INTO documents (id, title, project_id, created_by_id)
         VALUES ('d-child', 'Brief', 'p-root', 'u-owner')`
      );
      await client.query(
        `INSERT INTO jobs (id, type, payload, concurrency_class, max_attempts, backoff_ms, timeout_ms)
         VALUES ('j-phase3', 'test.work', '{}'::jsonb, 'derived-processing', 3, 1000, 1000)`
      );
      await client.query(
        `INSERT INTO dead_letters (
           id, job_id, type, payload, concurrency_class, attempts, max_attempts,
           backoff_ms, timeout_ms, last_error, enqueued_at
         ) VALUES (
           'dl-phase3', 'j-gone', 'test.work', '{}'::jsonb, 'derived-processing',
           3, 3, 1000, 1000, 'exhausted', now()
         )`
      );
      await client.query(
        `INSERT INTO devices (id, user_id, name, device_token_hash)
         VALUES ('dev-1', 'u-owner', 'Ada''s laptop', 'abc')`
      );
    });

    await migrate(scratch);
  }, 120_000);

  afterAll(async () => {
    await withClient(urlForDatabase("postgres"), (client) =>
      client.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB}`)
    );
  });

  it("gives Workspace-owned tables a nullable workspace_id and leaves the allowlist untouched", async () => {
    const tables = await publicTables(scratch);
    const nullability = await workspaceIdNullability(scratch);

    for (const table of NOT_WORKSPACE_OWNED) {
      expect(nullability.has(table), `${table} must not have workspace_id`).toBe(false);
    }

    const owned = tables.filter((table) => !NOT_WORKSPACE_OWNED.includes(table as (typeof NOT_WORKSPACE_OWNED)[number]));
    expect(owned.length).toBeGreaterThan(0);

    for (const table of owned) {
      expect(nullability.has(table), `${table} is Workspace-owned and needs workspace_id`).toBe(
        true
      );
    }

    expect(await columnsNamed(scratch, "users")).not.toContain("workspace_id");
    expect(await columnsNamed(scratch, "devices")).not.toContain("workspace_id");

    expect(nullability.get("projects")).toBe(true);
    expect(nullability.get("jobs")).toBe(true);
    expect(nullability.get("dead_letters")).toBe(true);
    expect(nullability.get("device_enrollments")).toBe(false);
  });

  it("backfills every existing row to the seeded Workspace, including Jobs, Dead Letters, and child Documents", async () => {
    const stamped = await withClient(scratch, (client) =>
      client.query<{
        project: string | null;
        document: string | null;
        job: string | null;
        dead_letter: string | null;
      }>(
        `SELECT
           (SELECT workspace_id FROM projects WHERE id = 'p-root') AS project,
           (SELECT workspace_id FROM documents WHERE id = 'd-child') AS document,
           (SELECT workspace_id FROM jobs WHERE id = 'j-phase3') AS job,
           (SELECT workspace_id FROM dead_letters WHERE id = 'dl-phase3') AS dead_letter`
      )
    );
    expect(stamped.rows[0]).toEqual({
      project: SEEDED_WORKSPACE_ID,
      document: SEEDED_WORKSPACE_ID,
      job: SEEDED_WORKSPACE_ID,
      dead_letter: SEEDED_WORKSPACE_ID,
    });
  });

  it("reports remaining nulls per table and does not apply NOT NULL", async () => {
    const report = await withClient(scratch, remainingWorkspaceIdNulls);
    const leftover = report.filter((row) => row.remainingNulls > 0);
    expect(leftover).toEqual([]);

    expect(report.find((row) => row.table === "projects")?.nullable).toBe(true);
    expect(report.find((row) => row.table === "jobs")?.nullable).toBe(true);
  });

  it("enrolls each existing Device on the seeded Workspace through the owner's Membership", async () => {
    const enrollments = await withClient(scratch, (client) =>
      client.query<{ device_id: string; workspace_id: string; membership_user: string }>(
        `SELECT de.device_id, de.workspace_id, m.user_id AS membership_user
           FROM device_enrollments de
           JOIN memberships m ON m.id = de.membership_id
          WHERE de.device_id = 'dev-1'`
      )
    );
    expect(enrollments.rows).toEqual([
      {
        device_id: "dev-1",
        workspace_id: SEEDED_WORKSPACE_ID,
        membership_user: "u-owner",
      },
    ]);
  });

  it("is a no-op on a second migrate", async () => {
    expect(await migrate(scratch)).toEqual([]);
    const report = await withClient(scratch, remainingWorkspaceIdNulls);
    expect(report.filter((row) => row.remainingNulls > 0)).toEqual([]);
  });
});

describe("Project write stamps workspace_id", () => {
  it("stamps the seeded Workspace in the same transaction as the insert, and a rollback drops the stamp", async () => {
    const { resetDb } = await import("../helpers/db");
    await resetDb();

    const { storage } = await import("../../server/storage");
    const { runWithWorkspaceContext } = await import("../../server/workspaceContext");
    const { db } = await import("../../server/db");
    const { projects } = await import("../../shared/schema");
    const { eq } = await import("drizzle-orm");

    const user = await storage.createUser({
      email: "tracer@example.test",
      password: "not-a-real-hash",
      firstName: "Ada",
    });

    const kept = await runWithWorkspaceContext({ workspaceId: SEEDED_WORKSPACE_ID }, () =>
      storage.createProject({ name: "Kept", ownerId: user.id })
    );
    expect(kept.workspaceId).toBe(SEEDED_WORKSPACE_ID);

    let rolledBackId = "";
    await expect(
      db.transaction(async (tx) => {
        const project = await runWithWorkspaceContext({ workspaceId: SEEDED_WORKSPACE_ID }, () =>
          storage.createProject({ name: "Rolled back", ownerId: user.id }, tx)
        );
        rolledBackId = project.id;
        expect(project.workspaceId).toBe(SEEDED_WORKSPACE_ID);
        tx.rollback();
      })
    ).rejects.toThrow();

    expect(
      await db.select({ id: projects.id }).from(projects).where(eq(projects.id, rolledBackId))
    ).toEqual([]);
    expect(
      await runWithWorkspaceContext({ workspaceId: SEEDED_WORKSPACE_ID }, () =>
        storage.getProject(kept.id)
      )
    ).toMatchObject({
      id: kept.id,
      workspaceId: SEEDED_WORKSPACE_ID,
    });
  });
});

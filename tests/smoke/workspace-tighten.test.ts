import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { remainingWorkspaceIdNulls } from "../../scripts/verify-workspace-backfill";
import { migrate } from "../../scripts/migrate";
import { urlForDatabase, withClient } from "../helpers/db";

/**
 * Phase 4 ticket #96: after the verifier is green, the journal sets
 * `workspace_id` NOT NULL on Workspace-owned tables and adds the core
 * composite uniques / FKs that include it. HTTP is not this suite — the
 * journal and a raw write are the seam.
 */

const AFTER_BACKFILL = "0008_giant_quasar";
const SCRATCH_DB = "docuflow_workspace_tighten";
const OTHER_WORKSPACE_ID = "other";

const GLOBAL_ALLOWLIST = [
  "users",
  "sessions",
  "desktop_releases",
  "scheduler_leases",
  "billing_webhook_inbox",
] as const;

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

describe("workspace_id tighten", () => {
  let scratch: string;

  beforeAll(async () => {
    await withClient(urlForDatabase("postgres"), async (client) => {
      await client.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB}`);
      await client.query(`CREATE DATABASE ${SCRATCH_DB}`);
    });
    scratch = urlForDatabase(SCRATCH_DB);

    await migrate(scratch, { applyThrough: AFTER_BACKFILL });
    const leftover = await withClient(scratch, remainingWorkspaceIdNulls);
    expect(leftover.filter((row) => row.remainingNulls > 0)).toEqual([]);

    await migrate(scratch);
  }, 120_000);

  afterAll(async () => {
    await withClient(urlForDatabase("postgres"), (client) =>
      client.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB}`)
    );
  });

  it("sets workspace_id NOT NULL on every Workspace-owned table once the verifier is green", async () => {
    const tables = await publicTables(scratch);
    const nullability = await workspaceIdNullability(scratch);
    const report = await withClient(scratch, remainingWorkspaceIdNulls);

    for (const table of NOT_WORKSPACE_OWNED) {
      expect(nullability.has(table), `${table} must not have workspace_id`).toBe(false);
    }

    const owned = tables.filter(
      (table) => !NOT_WORKSPACE_OWNED.includes(table as (typeof NOT_WORKSPACE_OWNED)[number])
    );
    expect(owned.length).toBeGreaterThan(0);

    for (const table of owned) {
      expect(nullability.get(table), `${table} workspace_id must be NOT NULL`).toBe(false);
    }

    expect(report.filter((row) => row.remainingNulls > 0 || row.nullable)).toEqual([]);
  });

  it("rejects a write that omits workspace_id", async () => {
    await withClient(scratch, async (client) => {
      await client.query(
        `INSERT INTO users (id, email, role, is_main_admin, created_at)
         VALUES ('u-tighten', 'tighten@example.test', 'user', 0, '2020-01-01')
         ON CONFLICT (id) DO NOTHING`
      );
      await expect(
        client.query(
          `INSERT INTO projects (id, name, owner_id)
           VALUES ('p-no-workspace', 'Stranded', 'u-tighten')`
        )
      ).rejects.toThrow(/null value in column "workspace_id"/i);
    });
  });

  it("scopes uniqueness per Workspace: the same CRM module slug can exist twice, but not inside one Workspace", async () => {
    await withClient(scratch, async (client) => {
      await client.query(
        `INSERT INTO workspaces (id, name) VALUES ($1, 'Other') ON CONFLICT (id) DO NOTHING`,
        [OTHER_WORKSPACE_ID]
      );
      await client.query(
        `INSERT INTO crm_modules (id, name, slug, workspace_id)
         VALUES ('mod-seeded', 'Projects', 'projects', 'seeded')`
      );
      await client.query(
        `INSERT INTO crm_modules (id, name, slug, workspace_id)
         VALUES ('mod-other', 'Projects', 'projects', $1)`,
        [OTHER_WORKSPACE_ID]
      );
      await expect(
        client.query(
          `INSERT INTO crm_modules (id, name, slug, workspace_id)
           VALUES ('mod-clash', 'Also Projects', 'projects', 'seeded')`
        )
      ).rejects.toThrow(/duplicate key/i);
    });
  });

  it("refuses a Document whose Project lives in another Workspace", async () => {
    await withClient(scratch, async (client) => {
      await client.query(
        `INSERT INTO workspaces (id, name) VALUES ($1, 'Other') ON CONFLICT (id) DO NOTHING`,
        [OTHER_WORKSPACE_ID]
      );
      await client.query(
        `INSERT INTO users (id, email, role, is_main_admin, created_at)
         VALUES ('u-rel', 'rel@example.test', 'user', 0, '2020-01-01')
         ON CONFLICT (id) DO NOTHING`
      );
      await client.query(
        `INSERT INTO projects (id, name, owner_id, workspace_id)
         VALUES ('p-a', 'Ours', 'u-rel', 'seeded')`
      );
      await expect(
        client.query(
          `INSERT INTO documents (id, title, project_id, workspace_id)
           VALUES ('d-cross', 'Leaked', 'p-a', $1)`,
          [OTHER_WORKSPACE_ID]
        )
      ).rejects.toThrow(/foreign key/i);
    });
  });

  it("refuses a Document whose parent lives in another Workspace", async () => {
    await withClient(scratch, async (client) => {
      await client.query(
        `INSERT INTO workspaces (id, name) VALUES ($1, 'Other') ON CONFLICT (id) DO NOTHING`,
        [OTHER_WORKSPACE_ID]
      );
      await client.query(
        `INSERT INTO users (id, email, role, is_main_admin, created_at)
         VALUES ('u-parent', 'parent@example.test', 'user', 0, '2020-01-01')
         ON CONFLICT (id) DO NOTHING`
      );
      await client.query(
        `INSERT INTO projects (id, name, owner_id, workspace_id)
         VALUES ('p-seeded-parent', 'Seeded', 'u-parent', 'seeded'),
                ('p-other-parent', 'Other', 'u-parent', $1)`,
        [OTHER_WORKSPACE_ID]
      );
      await client.query(
        `INSERT INTO documents (id, title, project_id, workspace_id)
         VALUES ('d-seeded-parent', 'Root', 'p-seeded-parent', 'seeded')`
      );
      await expect(
        client.query(
          `INSERT INTO documents (id, title, project_id, parent_id, workspace_id)
           VALUES ('d-other-child', 'Leaked child', 'p-other-parent', 'd-seeded-parent', $1)`,
          [OTHER_WORKSPACE_ID]
        )
      ).rejects.toThrow(/foreign key/i);
    });
  });

  it("scopes Job occurrence uniqueness per Workspace", async () => {
    await withClient(scratch, async (client) => {
      await client.query(
        `INSERT INTO workspaces (id, name) VALUES ($1, 'Other') ON CONFLICT (id) DO NOTHING`,
        [OTHER_WORKSPACE_ID]
      );
      const jobCols = `id, type, payload, workspace_id, concurrency_class, attempts, max_attempts, backoff_ms, timeout_ms, occurrence_key`;
      const jobVals = `'occ.work', '{}'::jsonb, $1, 'derived-processing', 0, 1, 1000, 1000, 'same-day'`;
      await client.query(
        `INSERT INTO jobs (${jobCols}) VALUES ('j-seeded-occ', ${jobVals})`,
        ["seeded"]
      );
      await client.query(
        `INSERT INTO jobs (${jobCols}) VALUES ('j-other-occ', ${jobVals})`,
        [OTHER_WORKSPACE_ID]
      );
      await expect(
        client.query(
          `INSERT INTO jobs (${jobCols}) VALUES ('j-clash-occ', ${jobVals})`,
          ["seeded"]
        )
      ).rejects.toThrow(/duplicate key/i);
    });
  });

  it("keeps org_settings and user authority columns because HTTP still reads them", async () => {
    const columns = await withClient(scratch, async (client) => {
      const settings = await client.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'org_settings'`
      );
      const users = await client.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'users'
            AND column_name IN ('role', 'is_main_admin', 'can_view_daily_updates', 'is_archived')
          ORDER BY column_name`
      );
      return {
        orgSettings: settings.rows.map((row) => row.table_name),
        userColumns: users.rows.map((row) => row.column_name),
      };
    });
    expect(columns.orgSettings).toEqual(["org_settings"]);
    expect(columns.userColumns).toEqual([
      "can_view_daily_updates",
      "is_archived",
      "is_main_admin",
      "role",
    ]);
  });
});

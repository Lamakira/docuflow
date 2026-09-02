import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { migrate } from "../../scripts/migrate";
import { urlForDatabase, withClient } from "../helpers/db";

/**
 * Phase 4 ticket #97: RLS on Workspace-owned tables, an application role that
 * cannot bypass it, and SET LOCAL of the Workspace GUC on request/Worker
 * transactions. HTTP is not this suite — the journal and a raw query as the
 * application role are the seam. Characterization stays on its own files.
 */

const SCRATCH_DB = "docuflow_workspace_rls";
const OTHER_WORKSPACE_ID = "other";
const APP_ROLE = "docuflow_app";
const APP_PASSWORD = "rls-harness";
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

function urlAsAppRole(ownerUrl: string): string {
  const url = new URL(ownerUrl);
  url.username = APP_ROLE;
  url.password = APP_PASSWORD;
  return url.toString();
}

async function rlsFlags(url: string): Promise<Map<string, { enabled: boolean; forced: boolean }>> {
  return withClient(url, async (client) => {
    const { rows } = await client.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'`
    );
    return new Map(
      rows.map((row) => [
        row.relname,
        { enabled: row.relrowsecurity, forced: row.relforcerowsecurity },
      ])
    );
  });
}

describe("workspace RLS", () => {
  let owner: string;
  let app: string;

  beforeAll(async () => {
    await withClient(urlForDatabase("postgres"), async (client) => {
      await client.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB}`);
      await client.query(`CREATE DATABASE ${SCRATCH_DB}`);
    });
    owner = urlForDatabase(SCRATCH_DB);
    await migrate(owner);
    await withClient(owner, (client) =>
      client.query(`ALTER ROLE ${APP_ROLE} WITH PASSWORD '${APP_PASSWORD}'`)
    );
    app = urlAsAppRole(owner);
  }, 120_000);

  afterAll(async () => {
    await withClient(urlForDatabase("postgres"), (client) =>
      client.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB}`)
    );
  });

  it("enables RLS on every Workspace-owned table and leaves the allowlist open", async () => {
    const tables = await publicTables(owner);
    const flags = await rlsFlags(owner);
    const owned = tables.filter(
      (table) => !NOT_WORKSPACE_OWNED.includes(table as (typeof NOT_WORKSPACE_OWNED)[number])
    );
    expect(owned.length).toBeGreaterThan(0);

    for (const table of owned) {
      expect(flags.get(table)?.enabled, `${table} must have RLS on`).toBe(true);
    }
    for (const table of NOT_WORKSPACE_OWNED) {
      expect(flags.get(table)?.enabled, `${table} must stay global`).toBe(false);
    }
  });

  it("gives the application role no BYPASSRLS and no superuser", async () => {
    const role = await withClient(owner, async (client) => {
      const { rows } = await client.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
        `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1`,
        [APP_ROLE]
      );
      return rows[0];
    });
    expect(role).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it("does not let the application role rewrite the migration ledger", async () => {
    await expect(
      withClient(app, (client) => client.query("DELETE FROM schema_migrations"))
    ).rejects.toThrow(/permission denied/i);
  });

  it("hides Workspace B's rows from a session scoped to A even without a WHERE", async () => {
    await withClient(owner, async (client) => {
      await client.query(
        `INSERT INTO workspaces (id, name) VALUES ($1, 'Other') ON CONFLICT (id) DO NOTHING`,
        [OTHER_WORKSPACE_ID]
      );
      await client.query(
        `INSERT INTO users (id, email, password, role, is_main_admin, created_at)
         VALUES ('u-rls', 'rls@example.test', 'x', 'user', 0, '2020-01-01')
         ON CONFLICT (id) DO NOTHING`
      );
      await client.query(
        `INSERT INTO projects (id, name, owner_id, workspace_id)
         VALUES ('p-ours', 'Ours', 'u-rls', 'seeded'),
                ('p-theirs', 'Theirs', 'u-rls', $1)
         ON CONFLICT (id) DO NOTHING`,
        [OTHER_WORKSPACE_ID]
      );
    });

    const visible = await withClient(app, async (client) => {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", ["seeded"]);
      const { rows } = await client.query<{ id: string }>(
        `SELECT id FROM projects ORDER BY id`
      );
      await client.query("COMMIT");
      return rows.map((row) => row.id);
    });

    expect(visible).toEqual(["p-ours"]);
  });

  it("returns no Workspace-owned rows when the scope GUC is missing", async () => {
    await withClient(owner, async (client) => {
      await client.query(
        `INSERT INTO users (id, email, password, role, is_main_admin, created_at)
         VALUES ('u-rls-closed', 'closed@example.test', 'x', 'user', 0, '2020-01-01')
         ON CONFLICT (id) DO NOTHING`
      );
      await client.query(
        `INSERT INTO projects (id, name, owner_id, workspace_id)
         VALUES ('p-hidden', 'Hidden', 'u-rls-closed', 'seeded')
         ON CONFLICT (id) DO NOTHING`
      );
    });
    const leaked = await withClient(app, async (client) => {
      const { rows } = await client.query<{ id: string }>(`SELECT id FROM projects`);
      return rows;
    });
    expect(leaked).toEqual([]);
  });

  it("sets Workspace scope locally for queries inside runWithWorkspaceContext", async () => {
    const { bindWorkspaceScope } = await import("../../server/workspaceScope");
    const { runWithWorkspaceContext } = await import("../../server/workspaceContext");

    await withClient(owner, async (client) => {
      await client.query(
        `INSERT INTO workspaces (id, name) VALUES ($1, 'Other') ON CONFLICT (id) DO NOTHING`,
        [OTHER_WORKSPACE_ID]
      );
      await client.query(
        `INSERT INTO users (id, email, password, role, is_main_admin, created_at)
         VALUES ('u-rls-scope', 'scope@example.test', 'x', 'user', 0, '2020-01-01')
         ON CONFLICT (id) DO NOTHING`
      );
      await client.query(
        `INSERT INTO projects (id, name, owner_id, workspace_id)
         VALUES ('p-scoped-ours', 'Ours', 'u-rls-scope', 'seeded'),
                ('p-scoped-theirs', 'Theirs', 'u-rls-scope', $1)
         ON CONFLICT (id) DO NOTHING`,
        [OTHER_WORKSPACE_ID]
      );
    });

    const pool = new pg.Pool({ connectionString: app });
    bindWorkspaceScope(pool);
    try {
      const visible = await runWithWorkspaceContext({ workspaceId: "seeded" }, () =>
        pool.query<{ id: string }>("SELECT id FROM projects ORDER BY id")
      );
      const ids = visible.rows.map((row) => row.id);
      expect(ids).toContain("p-scoped-ours");
      expect(ids).not.toContain("p-scoped-theirs");
      expect(ids).not.toContain("p-theirs");
    } finally {
      await pool.end();
    }
  });

  it("sets Workspace scope locally inside a drizzle transaction", async () => {
    const { bindWorkspaceScope } = await import("../../server/workspaceScope");
    const { runWithWorkspaceContext } = await import("../../server/workspaceContext");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { projects } = await import("../../shared/schema");

    await withClient(owner, async (client) => {
      await client.query(
        `INSERT INTO workspaces (id, name) VALUES ($1, 'Other') ON CONFLICT (id) DO NOTHING`,
        [OTHER_WORKSPACE_ID]
      );
      await client.query(
        `INSERT INTO users (id, email, password, role, is_main_admin, created_at)
         VALUES ('u-rls-tx', 'tx@example.test', 'x', 'user', 0, '2020-01-01')
         ON CONFLICT (id) DO NOTHING`
      );
      await client.query(
        `INSERT INTO projects (id, name, owner_id, workspace_id)
         VALUES ('p-tx-ours', 'Ours', 'u-rls-tx', 'seeded'),
                ('p-tx-theirs', 'Theirs', 'u-rls-tx', $1)
         ON CONFLICT (id) DO NOTHING`,
        [OTHER_WORKSPACE_ID]
      );
    });

    const pool = new pg.Pool({ connectionString: app });
    bindWorkspaceScope(pool);
    const db = drizzle({ client: pool });
    try {
      const rows = await runWithWorkspaceContext({ workspaceId: OTHER_WORKSPACE_ID }, () =>
        db.transaction((tx) => tx.select({ id: projects.id }).from(projects))
      );
      const ids = rows.map((row) => row.id);
      expect(ids).toContain("p-tx-theirs");
      expect(ids).not.toContain("p-tx-ours");
    } finally {
      await pool.end();
    }
  });

  it("rejects a write whose workspace_id does not match the transaction scope", async () => {
    await withClient(owner, async (client) => {
      await client.query(
        `INSERT INTO workspaces (id, name) VALUES ($1, 'Other') ON CONFLICT (id) DO NOTHING`,
        [OTHER_WORKSPACE_ID]
      );
      await client.query(
        `INSERT INTO users (id, email, password, role, is_main_admin, created_at)
         VALUES ('u-rls-forge', 'forge@example.test', 'x', 'user', 0, '2020-01-01')
         ON CONFLICT (id) DO NOTHING`
      );
    });
    await expect(
      withClient(app, async (client) => {
        await client.query("BEGIN");
        await client.query("SELECT set_config('app.workspace_id', $1, true)", ["seeded"]);
        await client.query(
          `INSERT INTO projects (id, name, owner_id, workspace_id)
           VALUES ('p-forged', 'Forged', 'u-rls-forge', $1)`,
          [OTHER_WORKSPACE_ID]
        );
        await client.query("COMMIT");
      })
    ).rejects.toThrow(/row-level security|policy/i);
  });
});

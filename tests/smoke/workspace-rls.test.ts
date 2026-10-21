import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { migrate } from "../../scripts/migrate";
import { urlForDatabase, withClient } from "../helpers/db";
import { TEST_APP_ROLE, TEST_APP_ROLE_PASSWORD } from "../test-db-url";

/**
 * Phase 4 ticket #97: RLS on Workspace-owned tables, an application role that
 * cannot bypass it, and SET LOCAL of the Workspace GUC on request/Worker
 * transactions. HTTP is not this suite — the journal and a raw query as the
 * application role are the seam. Characterization stays on its own files.
 */

const SCRATCH_DB = "docuflow_workspace_rls";
const OTHER_WORKSPACE_ID = "other";
const APP_ROLE = TEST_APP_ROLE;
const APP_PASSWORD = TEST_APP_ROLE_PASSWORD;
const GLOBAL_ALLOWLIST = [
  "users",
  "platform_staff",
  "desktop_releases",
  "scheduler_leases",
  "billing_webhook_inbox",
  "account_deletions",
] as const;

/** The Worker's queue claims across Workspaces; migration 0041 takes it out of RLS (#323). */
const QUEUE_WITHOUT_RLS = ["jobs", "dead_letters"] as const;

const NOT_WORKSPACE_OWNED = [
  ...GLOBAL_ALLOWLIST,
  ...QUEUE_WITHOUT_RLS,
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
      client.query(`ALTER ROLE ${APP_ROLE} WITH PASSWORD ${pg.escapeLiteral(APP_PASSWORD)}`)
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
        `INSERT INTO users (id, email, role, is_main_admin, created_at)
         VALUES ('u-rls', 'rls@example.test', 'user', 0, '2020-01-01')
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
        `INSERT INTO users (id, email, role, is_main_admin, created_at)
         VALUES ('u-rls-closed', 'closed@example.test', 'user', 0, '2020-01-01')
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
        `INSERT INTO users (id, email, role, is_main_admin, created_at)
         VALUES ('u-rls-scope', 'scope@example.test', 'user', 0, '2020-01-01')
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
        `INSERT INTO users (id, email, role, is_main_admin, created_at)
         VALUES ('u-rls-tx', 'tx@example.test', 'user', 0, '2020-01-01')
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
        `INSERT INTO users (id, email, role, is_main_admin, created_at)
         VALUES ('u-rls-forge', 'forge@example.test', 'user', 0, '2020-01-01')
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

  async function seedLocatorRows(): Promise<void> {
    await withClient(owner, async (client) => {
      await client.query(
        `INSERT INTO workspaces (id, name) VALUES ($1, 'Other') ON CONFLICT (id) DO NOTHING`,
        [OTHER_WORKSPACE_ID]
      );
      await client.query(
        `INSERT INTO workspace_roles (id, workspace_id, slug, name)
         VALUES ('other-member', $1, 'member', 'Member') ON CONFLICT (id) DO NOTHING`,
        [OTHER_WORKSPACE_ID]
      );
      await client.query(
        `INSERT INTO users (id, email, role, is_main_admin, created_at)
         VALUES ('u-loc', 'loc@example.test', 'user', 0, '2020-01-01')
         ON CONFLICT (id) DO NOTHING`
      );
      await client.query(
        `INSERT INTO memberships (id, workspace_id, user_id, workspace_role_id, archived_at)
         VALUES ('m-loc-seeded', 'seeded', 'u-loc', 'seeded-member', NULL),
                ('m-loc-other', $1, 'u-loc', 'other-member', '2021-02-03 04:05:06')
         ON CONFLICT (id) DO NOTHING`,
        [OTHER_WORKSPACE_ID]
      );
      await client.query(
        `INSERT INTO devices (id, user_id, name, device_token_hash)
         VALUES ('d-loc', 'u-loc', 'Laptop', 'hash-loc') ON CONFLICT (id) DO NOTHING`
      );
      await client.query(
        `INSERT INTO device_enrollments (id, device_id, workspace_id, membership_id)
         VALUES ('de-loc', 'd-loc', $1, 'm-loc-other') ON CONFLICT (id) DO NOTHING`,
        [OTHER_WORKSPACE_ID]
      );
      await client.query(
        `INSERT INTO agent_pairing_codes (id, user_id, code, expires_at, workspace_id)
         VALUES ('pc-loc', 'u-loc', 'LOC123', now() + interval '1 hour', $1)
         ON CONFLICT (id) DO NOTHING`,
        [OTHER_WORKSPACE_ID]
      );
      await client.query(
        `INSERT INTO service_accounts (id, name, key_hash, workspace_id)
         VALUES ('sa-loc', 'Key', 'key-hash-loc', $1) ON CONFLICT (id) DO NOTHING`,
        [OTHER_WORKSPACE_ID]
      );
      await client.query(
        `INSERT INTO invitations (id, workspace_id, email, workspace_role_id, token, status, invited_by_user_id, expires_at)
         VALUES ('inv-loc', $1, 'invitee@example.test', 'other-member', 'tok-loc', 'pending', 'u-loc', '2030-01-01')
         ON CONFLICT (id) DO NOTHING`,
        [OTHER_WORKSPACE_ID]
      );
      // One per (Workspace, email): the Workspaces' own rows for the same address.
      await client.query(
        `INSERT INTO invitations (id, workspace_id, email, workspace_role_id, token, status, invited_by_user_id, expires_at)
         VALUES ('inv-loc-expired', 'seeded', 'invitee@example.test', 'seeded-member', 'tok-loc-expired', 'pending', 'u-loc', '2020-01-01')
         ON CONFLICT (id) DO NOTHING`
      );
      await client.query(
        `INSERT INTO notifications (id, user_id, type, message, workspace_id)
         VALUES ('n-loc', 'u-loc', 'mention', 'Locator', $1) ON CONFLICT (id) DO NOTHING`,
        [OTHER_WORKSPACE_ID]
      );
      await client.query(
        `INSERT INTO projects (id, name, owner_id, workspace_id)
         VALUES ('p-loc', 'Locator', 'u-loc', $1) ON CONFLICT (id) DO NOTHING`,
        [OTHER_WORKSPACE_ID]
      );
      await client.query(
        `INSERT INTO crm_projects (id, project_id, workspace_id)
         VALUES ('cp-loc', 'p-loc', $1) ON CONFLICT (id) DO NOTHING`,
        [OTHER_WORKSPACE_ID]
      );
      await client.query(
        `INSERT INTO time_entries (id, user_id, crm_project_id, start_time, status, workspace_id)
         VALUES ('te-loc-old', 'u-loc', 'cp-loc', '2024-01-01', 'stopped', $1),
                ('te-loc', 'u-loc', 'cp-loc', '2024-02-01', 'running', $1)
         ON CONFLICT (id) DO NOTHING`,
        [OTHER_WORKSPACE_ID]
      );
    });
  }

  it("resolves each locator as docuflow_app with no Workspace scope", async () => {
    await seedLocatorRows();
    const call = (text: string, key: string) =>
      withClient(app, async (client) => (await client.query(text, [key])).rows);

    const memberships = await call("SELECT * FROM app_memberships_for_user($1) ORDER BY id", "u-loc");
    expect(memberships.map((row) => [row.id, row.workspace_id])).toEqual([
      ["m-loc-other", OTHER_WORKSPACE_ID],
      ["m-loc-seeded", "seeded"],
    ]);
    expect(memberships[0].archived_at).not.toBeNull();

    const [enrollment] = await call("SELECT * FROM app_enrollment_for_device($1)", "d-loc");
    expect(enrollment).toMatchObject({
      workspace_id: OTHER_WORKSPACE_ID,
      membership_id: "m-loc-other",
      user_id: "u-loc",
    });

    expect(await call("SELECT * FROM app_workspace_for_pairing_code($1)", "LOC123")).toEqual([
      { id: "pc-loc", workspace_id: OTHER_WORKSPACE_ID },
    ]);
    expect(await call("SELECT * FROM app_workspace_for_api_key($1)", "key-hash-loc")).toEqual([
      { id: "sa-loc", workspace_id: OTHER_WORKSPACE_ID, revoked_at: null },
    ]);
    // Only the pending, unexpired Invitation: the expired and accepted ones disclose nothing.
    const invitationRows = await call("SELECT * FROM app_invitations_for_email($1)", "invitee@example.test");
    expect(invitationRows).toHaveLength(1);
    expect(invitationRows[0]).toMatchObject({ id: "inv-loc", workspace_id: OTHER_WORKSPACE_ID, status: "pending" });
    expect(await call("SELECT * FROM app_invitation_for_token($1)", "tok-loc")).toEqual([
      { id: "inv-loc", workspace_id: OTHER_WORKSPACE_ID },
    ]);

    expect(await call("SELECT * FROM app_active_time_entry_for_user($1)", "u-loc")).toEqual([
      { id: "te-loc", workspace_id: OTHER_WORKSPACE_ID },
    ]);
    const entryWorkspace = (id: string, userId: string) =>
      withClient(app, async (client) =>
        (await client.query("SELECT * FROM app_time_entry_workspace_for_user($1, $2)", [id, userId])).rows
      );
    expect(await entryWorkspace("te-loc", "u-loc")).toEqual([{ workspace_id: OTHER_WORKSPACE_ID }]);
    // Bound to the User: someone else's id reveals nothing.
    expect(await entryWorkspace("te-loc", "someone-else")).toEqual([]);

    const notificationWorkspace = (id: string, userId: string) =>
      withClient(app, async (client) =>
        (await client.query("SELECT * FROM app_notification_workspace_for_user($1, $2)", [id, userId])).rows
      );
    expect(await notificationWorkspace("n-loc", "u-loc")).toEqual([{ workspace_id: OTHER_WORKSPACE_ID }]);
    expect(await notificationWorkspace("n-loc", "someone-else")).toEqual([]);

    // The same table, read directly, is still closed.
    const direct = await withClient(app, async (client) =>
      (await client.query("SELECT id FROM memberships")).rows
    );
    expect(direct).toEqual([]);
  });

  it("owns every locator as the owner of memberships and keeps PUBLIC from executing it", async () => {
    const rows = await withClient(owner, async (client) => {
      const { rows } = await client.query<{
        proname: string;
        owner: string;
        table_owner: string;
        secdef: boolean;
        public_exec: boolean;
        app_exec: boolean;
      }>(
        `SELECT p.proname,
                pg_get_userbyid(p.proowner) AS owner,
                pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid = 'public.memberships'::regclass)) AS table_owner,
                p.prosecdef AS secdef,
                EXISTS (
                  SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0
                ) AS public_exec,
                has_function_privilege($1, p.oid, 'EXECUTE') AS app_exec
           FROM pg_proc p
          WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'app\\_%'
          ORDER BY p.proname`,
        [APP_ROLE]
      );
      return rows;
    });
    expect(rows.map((row) => row.proname)).toEqual([
      "app_active_time_entry_for_user",
      "app_enrollment_for_device",
      "app_invitation_for_token",
      "app_invitations_for_email",
      "app_memberships_for_user",
      "app_notification_workspace_for_user",
      "app_time_entry_workspace_for_user",
      "app_workspace_for_api_key",
      "app_workspace_for_pairing_code",
    ]);
    for (const row of rows) {
      expect(row.owner, row.proname).toBe(row.table_owner);
      expect(row.secdef, row.proname).toBe(true);
      expect(row.public_exec, `${row.proname} must not be executable by PUBLIC`).toBe(false);
      expect(row.app_exec, row.proname).toBe(true);
    }
  });

  it("keeps PUBLIC from executing any SECURITY DEFINER function in public, and lets docuflow_app", async () => {
    const rows = await withClient(owner, async (client) => {
      const { rows } = await client.query<{ proname: string; public_exec: boolean; app_exec: boolean }>(
        `SELECT p.proname,
                EXISTS (
                  SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0
                ) AS public_exec,
                has_function_privilege($1, p.oid, 'EXECUTE') AS app_exec
           FROM pg_proc p
          WHERE p.prosecdef AND p.pronamespace = 'public'::regnamespace
          ORDER BY p.proname`,
        [APP_ROLE]
      );
      return rows;
    });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.public_exec, `${row.proname} must not be executable by PUBLIC`).toBe(false);
      expect(row.app_exec, `${row.proname} must be executable by ${APP_ROLE}`).toBe(true);
    }
  });

  describe("tripwire and in-transaction re-scoping", () => {
    async function scopedDb(mode: "throw" | "warn" | "ignore") {
      const { bindWorkspaceScope } = await import("../../server/workspaceScope");
      const { drizzle } = await import("drizzle-orm/node-postgres");
      const schema = await import("../../shared/schema");
      const pool = new pg.Pool({ connectionString: app });
      bindWorkspaceScope(pool, { onUnscopedRlsQuery: mode });
      return { pool, db: drizzle({ client: pool, schema }), schema };
    }

    it("throws on a table named without a Workspace context, and passes inside one", async () => {
      await seedLocatorRows();
      const { UnscopedRlsQueryError } = await import("../../server/workspaceScope");
      const { runWithWorkspaceContext } = await import("../../server/workspaceContext");
      const { sql } = await import("drizzle-orm");
      const { pool, db, schema } = await scopedDb("throw");
      try {
        await expect(db.select().from(schema.memberships)).rejects.toBeInstanceOf(UnscopedRlsQueryError);
        await expect(db.select().from(schema.memberships)).rejects.toThrow(/"memberships".*runWithWorkspaceContext/);
        await expect(pool.query("SELECT count(*) FROM jobs")).resolves.toBeDefined(); // jobs left RLS
        await expect(pool.query("SELECT count(*) FROM projects")).rejects.toBeInstanceOf(UnscopedRlsQueryError);

        const inside = await runWithWorkspaceContext({ workspaceId: "seeded" }, async () =>
          // awaited inside the callback: drizzle builders run when awaited
          await db.select().from(schema.memberships)
        );
        expect(inside.map((row) => row.id)).toEqual(["m-loc-seeded"]);

        const located = await db.execute(sql`SELECT * FROM app_memberships_for_user(${"u-loc"})`);
        expect(located.rows).toHaveLength(2);
      } finally {
        await pool.end();
      }
    });

    it("applies the tripwire to a transaction client with no context", async () => {
      const { UnscopedRlsQueryError } = await import("../../server/workspaceScope");
      const { pool } = await scopedDb("throw");
      try {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await expect(client.query('SELECT * FROM "memberships"')).rejects.toBeInstanceOf(UnscopedRlsQueryError);
        } finally {
          await client.query("ROLLBACK");
          client.release();
        }
      } finally {
        await pool.end();
      }
    });

    it("sees only its own Workspace's rows when a transaction enters two contexts in turn", async () => {
      await seedLocatorRows();
      await withClient(owner, (client) =>
        client.query(
          `INSERT INTO projects (id, name, owner_id, workspace_id)
           VALUES ('p-rs-ours', 'Ours', 'u-loc', 'seeded'), ('p-rs-theirs', 'Theirs', 'u-loc', $1)
           ON CONFLICT (id) DO NOTHING`,
          [OTHER_WORKSPACE_ID]
        )
      );
      const { runWithWorkspaceContext } = await import("../../server/workspaceContext");
      const { pool, db, schema } = await scopedDb("throw");
      try {
        const ids = async (workspaceId: string, tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) =>
          (await runWithWorkspaceContext({ workspaceId }, async () => await tx.select({ id: schema.projects.id }).from(schema.projects)))
            .map((row) => row.id)
            .filter((id) => id.startsWith("p-rs-"));

        const seen = await db.transaction(async (tx) => {
          const first = await ids("seeded", tx);
          const second = await ids(OTHER_WORKSPACE_ID, tx);
          const third = await ids("seeded", tx);
          return { first, second, third };
        });
        expect(seen).toEqual({
          first: ["p-rs-ours"],
          second: ["p-rs-theirs"],
          third: ["p-rs-ours"],
        });
      } finally {
        await pool.end();
      }
    });
  });
});

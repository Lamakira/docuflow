import { Client } from "pg";
import { resolveTestDatabaseUrl } from "../test-db-url";

/**
 * Truncate every application table between tests. RESTART IDENTITY + CASCADE
 * gives each test a clean database without re-running the migrations.
 *
 * `schema_migrations` is not an application table — it is what the runner reads
 * to know the database is already built. Truncating it would make the next run
 * replay the whole journal against a schema that already exists.
 */
export async function resetDb(): Promise<void> {
  const { pool } = await import("../../server/db");
  const { rows } = await pool.query(
    `SELECT tablename FROM pg_tables
     WHERE schemaname = 'public'
       AND tablename NOT LIKE '\\_\\_drizzle%'
       AND tablename <> 'schema_migrations'`
  );
  if (rows.length === 0) return;
  const tables = rows.map((r: { tablename: string }) => `"${r.tablename}"`).join(", ");
  await pool.query(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`);
  await restoreSeededWorkspaceCatalog();
}

/**
 * Truncate drops the journaled seed. Put the catalog back so new Users can
 * receive a Membership in the seeded Workspace without re-running migrate.
 */
async function restoreSeededWorkspaceCatalog(): Promise<void> {
  const { pool } = await import("../../server/db");
  await pool.query(`
    INSERT INTO capabilities (id, name)
    VALUES ('view_daily_updates', 'View daily updates')
    ON CONFLICT (id) DO NOTHING;
    INSERT INTO workspaces (id, name)
    VALUES ('seeded', 'DocuFlow')
    ON CONFLICT (id) DO NOTHING;
    INSERT INTO workspace_roles (id, workspace_id, slug, name)
    VALUES
      ('seeded-owner', 'seeded', 'owner', 'Owner'),
      ('seeded-administrator', 'seeded', 'administrator', 'Administrator'),
      ('seeded-member', 'seeded', 'member', 'Member')
    ON CONFLICT (id) DO NOTHING;
    INSERT INTO workspace_role_capabilities (workspace_role_id, capability_id, workspace_id)
    SELECT id, 'view_daily_updates', 'seeded'
      FROM workspace_roles
     WHERE workspace_id = 'seeded' AND slug IN ('owner', 'administrator')
    ON CONFLICT (workspace_role_id, capability_id) DO NOTHING;
  `);
}

/**
 * Another database on the harness's own Postgres server, by name.
 *
 * The smoke suites that build a database from scratch each need two connections
 * — one to `postgres` to CREATE/DROP, one to the throwaway they made — and the
 * server they use has to be the harness's, which `tests/test-db-url.ts` refuses
 * to let point anywhere remote (ADR-0018).
 */
export function urlForDatabase(name: string): string {
  const url = new URL(resolveTestDatabaseUrl());
  url.pathname = `/${name}`;
  return url.toString();
}

/** One `pg` connection for one job, closed however the job ends. */
export async function withClient<T>(
  url: string,
  use: (client: Client) => Promise<T>
): Promise<T> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await use(client);
  } finally {
    await client.end();
  }
}

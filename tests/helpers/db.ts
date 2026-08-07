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
}

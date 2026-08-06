/**
 * Truncate every application table between tests. RESTART IDENTITY + CASCADE
 * gives each test a clean database without re-running the schema push.
 */
export async function resetDb(): Promise<void> {
  const { pool } = await import("../../server/db");
  const { rows } = await pool.query(
    `SELECT tablename FROM pg_tables
     WHERE schemaname = 'public' AND tablename NOT LIKE '\\_\\_drizzle%'`
  );
  if (rows.length === 0) return;
  const tables = rows.map((r: { tablename: string }) => `"${r.tablename}"`).join(", ");
  await pool.query(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`);
}

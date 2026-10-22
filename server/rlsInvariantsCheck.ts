/**
 * Boot-time detector for #328: `jobs` and `dead_letters` must be outside RLS
 * (migration 0041). Read-only, as the app role. It only reports: the rest of the
 * app works, so it never refuses to boot, and a failing query is logged and
 * ignored. The fix is applied by the invariants step in `scripts/migrate.ts`,
 * which every publish runs.
 */

import { RLS_EXEMPT_TABLES, WORKSPACE_ISOLATION_POLICY } from "../shared/rlsInvariants";
import type { DbPool } from "./db";
import { logError } from "./logger";

/** Returns the message logged, or null when all tables are outside RLS. */
export async function checkRlsInvariantsAtBoot(
  pool: Pick<DbPool, "query">,
  tables: readonly string[] = RLS_EXEMPT_TABLES,
  report: (message: string) => void = (message) => logError("rls-invariant-violated", new Error(message), { tables })
): Promise<string | null> {
  try {
    const { rows } = await pool.query(
      `SELECT relname FROM pg_class
        WHERE relrowsecurity AND relnamespace = 'public'::regnamespace AND relname = ANY($1)
        ORDER BY relname`,
      [[...tables]]
    );
    const bad = rows.map((row: { relname: string }) => row.relname);
    if (bad.length === 0) return null;

    const fix = bad
      .map(
        (t) =>
          `DROP POLICY IF EXISTS ${WORKSPACE_ISOLATION_POLICY} ON ${t}; ALTER TABLE ${t} DISABLE ROW LEVEL SECURITY;`
      )
      .join(" ");
    const message =
      `Row-level security is ON for ${bad.join(", ")}, which must be outside RLS (migration 0041, #328); ` +
      `Job enqueues will fail. Run as the owner: ${fix} ` +
      `The next publish re-asserts this via the invariants step of dist/migrate.mjs.`;
    report(message);
    return message;
  } catch (error) {
    console.error("[rls-invariants] boot check skipped:", error instanceof Error ? error.message : error);
    return null;
  }
}

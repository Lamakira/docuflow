/**
 * Re-asserts that the queue tables stay outside row-level security (#328).
 *
 * Migration 0041 disables RLS on `jobs` and `dead_letters`, and production
 * records it as applied, yet on 2026-10-21 both had RLS and their
 * `workspace_isolation` policy back (suspected: Replit's publish-time schema
 * propagation). `scripts/migrate.ts` runs this after the migrations on every
 * publish, as the migration owner. Idempotent: a correct table is left alone.
 */

import type pg from "pg";
import { RLS_EXEMPT_TABLES, WORKSPACE_ISOLATION_POLICY } from "../../shared/rlsInvariants";
import type { Report } from "./db";

/** Double-quotes an identifier so a table name can never alter the statement. */
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Returns one line per table changed; empty when everything was already correct. */
export async function assertRlsInvariants(
  client: Pick<pg.ClientBase, "query">,
  report: Report = () => {},
  tables: readonly string[] = RLS_EXEMPT_TABLES
): Promise<string[]> {
  const changes: string[] = [];

  for (const table of tables) {
    const { rows } = await client.query<{ rls: boolean; policy: boolean }>(
      `SELECT c.relrowsecurity AS rls,
              EXISTS (SELECT 1 FROM pg_policy p
                      WHERE p.polrelid = c.oid AND p.polname = $2) AS policy
         FROM pg_class c
        WHERE c.oid = to_regclass($1)`,
      [quoteIdent(table), WORKSPACE_ISOLATION_POLICY]
    );
    const state = rows[0];
    if (!state || (!state.rls && !state.policy)) continue;

    await client.query(`DROP POLICY IF EXISTS ${WORKSPACE_ISOLATION_POLICY} ON ${quoteIdent(table)}`);
    await client.query(`ALTER TABLE ${quoteIdent(table)} DISABLE ROW LEVEL SECURITY`);

    const done: string[] = [];
    if (state.rls) done.push("RLS disabled");
    if (state.policy) done.push(`policy ${WORKSPACE_ISOLATION_POLICY} dropped`);
    changes.push(`${table}: ${done.join(", ")}`);
  }

  if (changes.length === 0) report(`[invariants] ${tables.join(", ")}: already outside RLS, nothing changed`);
  for (const change of changes) report(`[invariants] ${change}`);
  return changes;
}

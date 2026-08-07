/**
 * The database connection the operational scripts use.
 *
 * Deliberately not `server/db.ts`: that module imports `server/config.ts`, which
 * resolves — and refuses to boot without — every variable the *server* needs,
 * including object storage and email. A migration or seed run needs a database
 * URL and nothing else, and must not be blocked by a variable it will never use.
 *
 * The URL itself is resolved by `shared/databaseUrl.ts`, the one rule the server
 * follows too. node-postgres over TLS reaches Neon the same way it reaches a
 * local container, so no script depends on the serverless driver (ADR-0016: no
 * Neon-specific features).
 */

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { requireDatabaseUrl } from "../../shared/databaseUrl";
import * as schema from "../../shared/schema";

export type ScriptDb = ReturnType<typeof drizzle<typeof schema>>;

/**
 * Where a script sends its progress. Defaulted to silence so a test can call the
 * same function the CLI does without printing through the run.
 */
export type Report = (message: string) => void;

/** Opens a pool for one script run. The caller closes it. */
export function openDb(url: string = requireDatabaseUrl()): {
  db: ScriptDb;
  close: () => Promise<void>;
} {
  const pool = new pg.Pool({ connectionString: url });
  return { db: drizzle({ client: pool, schema }), close: () => pool.end() };
}

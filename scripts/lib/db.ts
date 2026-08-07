/**
 * The database connection the operational scripts use.
 *
 * Deliberately not `server/db.ts`: that module imports `server/config.ts`, which
 * resolves — and refuses to boot without — every variable the *server* needs,
 * including object storage and email. A migration or seed run needs a database
 * URL and nothing else, and must not be blocked by a variable it will never use.
 *
 * Resolution matches `server/config.ts` and `drizzle.config.ts`: `DATABASE_URL`,
 * or every `PG*` variable instead. node-postgres over TLS reaches Neon the same
 * way it reaches a local container, so no script depends on the serverless
 * driver (ADR-0016: no Neon-specific features).
 */

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "../../shared/schema";

export function resolveDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

  const missing = ["PGHOST", "PGUSER", "PGPASSWORD", "PGDATABASE"].filter(
    (name) => !process.env[name]
  );
  if (missing.length > 0) {
    throw new Error(
      `Database not configured.\n` +
        `Set DATABASE_URL, or all PG* variables.\n` +
        `Missing: ${missing.join(", ")}`
    );
  }

  const password = encodeURIComponent(process.env.PGPASSWORD!);
  const port = process.env.PGPORT ?? "5432";
  return (
    `postgresql://${process.env.PGUSER}:${password}` +
    `@${process.env.PGHOST}:${port}/${process.env.PGDATABASE}`
  );
}

export type ScriptDb = ReturnType<typeof drizzle<typeof schema>>;

/** Opens a pool for one script run. The caller closes it. */
export function openDb(url: string = resolveDatabaseUrl()): {
  db: ScriptDb;
  close: () => Promise<void>;
} {
  const pool = new pg.Pool({ connectionString: url });
  return { db: drizzle({ client: pool, schema }), close: () => pool.end() };
}

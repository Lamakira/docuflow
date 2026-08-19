/**
 * databaseUrl.ts — how every process in this repository finds its database.
 *
 * `DATABASE_URL` wins; otherwise the `PG*` variables are assembled into one.
 * That rule was written out separately in the server config, the drizzle config,
 * and four scripts, which is five chances for them to disagree about a default
 * port or a URL-encoded password. It lives here once instead.
 *
 * `shared/` because both sides import it: the server through `server/config.ts`,
 * and the CLIs directly. It reads the environment through an injected accessor
 * so `server/config.ts` keeps its own rule that a whitespace-only variable is
 * unset, and so tests can resolve against an environment they construct.
 */

/** Absent any one of these, the `PG*` route cannot produce a URL. */
export const REQUIRED_PG_VARS = ["PGHOST", "PGUSER", "PGPASSWORD", "PGDATABASE"] as const;

/** Every variable the `PG*` route reads, in the order humans expect them listed. */
export const PG_VARS = ["PGHOST", "PGPORT", "PGUSER", "PGPASSWORD", "PGDATABASE"] as const;

export const DEFAULT_PG_PORT = "5432";

export type EnvRead = (name: string) => string | undefined;

const fromProcessEnv: EnvRead = (name) => process.env[name];

export type DatabaseUrlSource = "DATABASE_URL" | "PG_VARS";

export interface ResolvedDatabaseUrl {
  /** Null when `DATABASE_URL` is unset and the `PG*` set is incomplete. */
  url: string | null;
  source: DatabaseUrlSource;
  /** The required `PG*` variables found absent. Empty whenever `url` is set. */
  missing: string[];
}

/**
 * Resolve without throwing, so a caller collecting several configuration faults
 * can add this one to its pile rather than aborting on it.
 */
export function resolveDatabaseUrl(read: EnvRead = fromProcessEnv): ResolvedDatabaseUrl {
  const direct = read("DATABASE_URL");
  if (direct) return { url: direct, source: "DATABASE_URL", missing: [] };

  const missing = REQUIRED_PG_VARS.filter((name) => !read(name));
  if (missing.length > 0) return { url: null, source: "PG_VARS", missing: [...missing] };

  const password = encodeURIComponent(read("PGPASSWORD")!);
  const port = read("PGPORT") ?? DEFAULT_PG_PORT;
  return {
    url: `postgresql://${read("PGUSER")}:${password}@${read("PGHOST")}:${port}/${read("PGDATABASE")}`,
    source: "PG_VARS",
    missing: [],
  };
}

/**
 * The URL, or an error naming what is absent. For the CLIs, which have nothing
 * to collect faults into and should stop at the first thing they cannot do.
 */
export function requireDatabaseUrl(read: EnvRead = fromProcessEnv): string {
  const { url, missing } = resolveDatabaseUrl(read);
  if (url) return url;

  throw new Error(
    `Database not configured.\n` +
      `Set DATABASE_URL, or all PG* variables.\n` +
      `Missing: ${missing.join(", ")}`
  );
}

/**
 * The credential that is allowed to change schema. Distinct from the
 * application role, which cannot bypass RLS (#97). Unset means migrate uses
 * the same URL the application uses — today's owner connection.
 */
export function requireMigrateDatabaseUrl(read: EnvRead = fromProcessEnv): string {
  return read("DATABASE_MIGRATE_URL") ?? requireDatabaseUrl(read);
}

/** A connection string with the password replaced — the only form safe to log. */
export function maskDatabaseUrl(url: string): string {
  return url.replace(/:([^@/]+)@/, ":<hidden>@");
}

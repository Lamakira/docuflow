/**
 * Row-level security backs up query scoping (ADR-0006, #97) only while the
 * runtime role is subject to it. A superuser, a BYPASSRLS role, or the owner of
 * the Workspace-owned tables turns every policy off without an error, so the
 * role `DATABASE_URL` connects as is checked (#297).
 *
 * Production refuses to start when the database answers at boot. The pool
 * still connects on first use, so a database that is not up yet is checked by
 * the first query instead, and no query runs until it passes. Development and
 * test connect as the database owner on purpose, so there the same finding is
 * a warning.
 */

import type { DbPool } from "./db";

export interface RuntimeRole {
  name: string;
  superuser: boolean;
  bypassRls: boolean;
  /** Whether RLS applies to this role on a Workspace-owned table; false for a table owner. */
  rowSecurityActive: boolean;
}

export class RlsBypassRoleError extends Error {
  constructor(readonly role: RuntimeRole) {
    const reasons = [
      role.superuser && "SUPERUSER",
      role.bypassRls && "BYPASSRLS",
      !role.superuser && !role.bypassRls && !role.rowSecurityActive && "owns the Workspace-owned tables",
    ].filter(Boolean);
    super(
      `Database role "${role.name}" bypasses row-level security (${reasons.join(", ")}). ` +
        `Point DATABASE_URL at docuflow_app and keep the owner in DATABASE_MIGRATE_URL.`
    );
    this.name = "RlsBypassRoleError";
  }
}

export async function readRuntimeRole(pool: Pick<DbPool, "query">): Promise<RuntimeRole> {
  const { rows } = await pool.query(
    `SELECT r.rolname AS name,
            r.rolsuper AS superuser,
            r.rolbypassrls AS bypass_rls,
            coalesce(row_security_active(to_regclass('public.projects')), false) AS row_security_active
       FROM pg_roles r
      WHERE r.rolname = current_user`
  );
  const [row] = rows;
  return {
    name: row.name,
    superuser: row.superuser,
    bypassRls: row.bypass_rls,
    rowSecurityActive: row.row_security_active,
  };
}

export async function assertRuntimeRoleEnforcesRls(options: {
  pool: Pick<DbPool, "query">;
  production: boolean;
  warn?: (message: string) => void;
}): Promise<RuntimeRole> {
  const role = await readRuntimeRole(options.pool);
  if (!role.superuser && !role.bypassRls && role.rowSecurityActive) return role;
  const bypass = new RlsBypassRoleError(role);
  if (options.production) throw bypass;
  (options.warn ?? console.warn)(bypass.message);
  return role;
}

type Callback = (...args: any[]) => void;
type PoolClient = Pick<DbPool, "query"> & { release: (err?: unknown) => void };

/** The two ways into a pg-compatible pool; `workspaceScope.ts` wraps the same pair. */
export interface GateablePool {
  query: (...args: never[]) => unknown;
  connect: (...args: never[]) => unknown;
}

/**
 * Check the role once, and in production hold every query and checkout until
 * that check has passed. A bypass role fails every one of them; an unreachable
 * database is not remembered, so the next use checks again.
 */
export function gateOnRuntimeRole(
  pool: GateablePool,
  options: { production: boolean; warn?: (message: string) => void },
): () => Promise<RuntimeRole> {
  const query = pool.query.bind(pool) as unknown as (...args: unknown[]) => Promise<unknown>;
  const connect = pool.connect.bind(pool) as unknown as () => Promise<PoolClient>;
  // Its own checkout: pg's `pool.query` goes back through `pool.connect`.
  const onOwnClient: Pick<DbPool, "query"> = {
    query: async (text, values) => {
      const client = await connect();
      try {
        return await client.query(text, values);
      } finally {
        client.release();
      }
    },
  };
  let checked: Promise<RuntimeRole> | null = null;
  const verify = () =>
    (checked ??= assertRuntimeRoleEnforcesRls({ pool: onOwnClient, ...options }).catch((error) => {
      if (!(error instanceof RlsBypassRoleError)) checked = null;
      throw error;
    }));
  if (!options.production) return verify;

  const settle = <T>(run: Promise<T>, cb: Callback | undefined, deliver: (value: T) => unknown[]) => {
    if (!cb) return run;
    run.then((value) => cb(null, ...deliver(value)), (error) => cb(error));
    return undefined;
  };

  pool.query = ((...args: unknown[]) => {
    const cb = typeof args.at(-1) === "function" ? (args.pop() as Callback) : undefined;
    const run = verify().then(() => query(...args));
    return settle(run, cb, (result) => [result]);
  }) as GateablePool["query"];

  pool.connect = ((cb?: Callback) =>
    settle(verify().then(() => connect()), cb, (client) => [client, (err?: unknown) => client.release(err)])
  ) as GateablePool["connect"];

  return verify;
}

/** Boot's half: a bypass role stops it; a database that is not up yet does not. */
export async function checkRuntimeRoleAtBoot(
  verify: () => Promise<RuntimeRole>,
  warn: (message: string) => void = console.warn,
): Promise<void> {
  try {
    await verify();
  } catch (error) {
    if (error instanceof RlsBypassRoleError) throw error;
    warn(
      `Database role not checked at boot (${error instanceof Error ? error.message : String(error)}); ` +
        `in production the first query checks it before anything runs.`
    );
  }
}

/**
 * Row-level security backs up query scoping (ADR-0006, #97) only while the
 * runtime role is subject to it. A superuser, a BYPASSRLS role, or the owner of
 * the Workspace-owned tables turns every policy off without an error, so the
 * role `DATABASE_URL` connects as is checked (#297).
 *
 * Production and test refuse a bypassing role outright; development refuses it
 * too unless `DOCUFLOW_ALLOW_OWNER_DB=1`, in which case it is a warning (#323).
 * A suite that runs as the owner passes without ever exercising a policy, so
 * the harness connects as `docuflow_app`. Where it refuses, boot stops when the
 * database answers; the pool still connects on first use, so a database that is
 * not up yet is checked by the first query instead, and no query runs until it
 * passes.
 */

import type { DbPool } from "./db";

export interface RuntimeRole {
  name: string;
  superuser: boolean;
  bypassRls: boolean;
  /** Whether RLS applies to this role on a Workspace-owned table; false for a table owner. */
  rowSecurityActive: boolean;
}

const PRODUCTION_REMEDY = `Point DATABASE_APP_URL (or DATABASE_URL) at docuflow_app and keep the owner in DATABASE_MIGRATE_URL.`;

/** Local database name and port are docker-compose.yml's (`docuflow_dev` on 5434). */
const DEVELOPMENT_REMEDY =
  `Locally: set DATABASE_APP_URL=postgresql://docuflow_app:docuflow_app_dev@localhost:5434/docuflow_dev in .env ` +
  `and run \`npm run db:app-role\` (an existing volume's docuflow_app has no password: the init script only runs ` +
  `on an empty volume). To bypass temporarily, set DOCUFLOW_ALLOW_OWNER_DB=1.`;

export class RlsBypassRoleError extends Error {
  constructor(readonly role: RuntimeRole, options: { development?: boolean } = {}) {
    const reasons = [
      role.superuser && "SUPERUSER",
      role.bypassRls && "BYPASSRLS",
      !role.superuser && !role.bypassRls && !role.rowSecurityActive && "owns the Workspace-owned tables",
    ].filter(Boolean);
    super(
      `Database role "${role.name}" bypasses row-level security (${reasons.join(", ")}). ` +
        (options.development ? DEVELOPMENT_REMEDY : PRODUCTION_REMEDY)
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
  /** Throw on a bypassing role; false only warns. */
  refuse: boolean;
  /** Local development: the message says how to set the role up on this machine. */
  development?: boolean;
  warn?: (message: string) => void;
}): Promise<RuntimeRole> {
  const role = await readRuntimeRole(options.pool);
  if (!role.superuser && !role.bypassRls && role.rowSecurityActive) return role;
  const bypass = new RlsBypassRoleError(role, { development: options.development });
  if (options.refuse) throw bypass;
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
 * Check the role once, and where it refuses hold every query and checkout until
 * that check has passed. A bypass role fails every one of them; an unreachable
 * database is not remembered, so the next use checks again.
 */
export function gateOnRuntimeRole(
  pool: GateablePool,
  options: { refuse: boolean; development?: boolean; warn?: (message: string) => void },
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
  if (!options.refuse) return verify;

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
        `where a bypass role is refused, the first query checks it before anything runs.`
    );
  }
}

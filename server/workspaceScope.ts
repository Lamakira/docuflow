/**
 * SET LOCAL app.workspace_id on the connection that actually runs the query
 * (#97). Request and Worker work already bind WorkspaceContext on the ALS;
 * this is the database half of that seam. The GUC is local to the transaction
 * so a pooled connection cannot leak one Workspace into the next checkout.
 *
 * Inside an open transaction the context can change (`runWithWorkspaceContext`
 * entered after BEGIN): the client remembers which Workspace it applied and
 * re-applies before the next statement only when the context differs (#323).
 *
 * A statement that names a row-level-security table while no Workspace context
 * is bound matches no row under `docuflow_app`. The tripwire (#323) turns that
 * silent emptiness into an error, or a warning in production, naming the table.
 *
 * The context reader is registered from workspaceContext.ts so this module
 * does not import `server/db.ts` (that file imports us).
 */

import type pg from "pg";
import { logWarn } from "./logger";

const WORKSPACE_GUC = "app.workspace_id";

/** What "no Workspace" sets: `workspace_id = ''` matches no row, so it fails closed. */
const NO_WORKSPACE = "";

type ContextReader = () => { workspaceId: string } | undefined;

let readContext: ContextReader = () => undefined;

export function setWorkspaceContextReader(read: ContextReader): void {
  readContext = read;
}

export type UnscopedRlsMode = "throw" | "warn" | "ignore";

export interface WorkspaceScopeOptions {
  /** A statement on an RLS table with no Workspace context. Default `ignore`. */
  onUnscopedRlsQuery?: UnscopedRlsMode;
}

export class UnscopedRlsQueryError extends Error {
  constructor(readonly table: string, readonly statement = "") {
    super(
      `Query on row-level-security table "${table}" ran with no Workspace context. ` +
        `Run it inside runWithWorkspaceContext, or resolve the Workspace through a ` +
        `server/workspaceLocators.ts function.` +
        (statement ? ` Statement: ${statement.replace(/\s+/g, " ").slice(0, 160)}` : "")
    );
    this.name = "UnscopedRlsQueryError";
  }
}

type Queryable = {
  query: (...args: never[]) => unknown;
  connect: (...args: never[]) => unknown;
  release?: (err?: unknown) => void;
};

type Connect = {
  (): Promise<pg.PoolClient>;
  (cb: (err: Error | null, client?: pg.PoolClient, release?: (err?: unknown) => void) => void): void;
};

const RLS_TABLES_SQL =
  "SELECT relname FROM pg_class WHERE relrowsecurity AND relkind = 'r' AND relnamespace = 'public'::regnamespace";

/** Transaction control and GUC statements name no table. */
const CONTROL_STATEMENT =
  /^\s*(?:begin|start\s+transaction|commit|end|rollback|abort|savepoint|release|set|show)\b|^\s*select\s+set_config\s*\(/i;
const QUOTED_NAME = /"([^"]+)"/g;
const BARE_AFTER_KEYWORD = /\b(?:from|join|into|update|table)\s+(?:only\s+)?(?:public\.)?([a-z_][a-z0-9_]*)\b/gi;

/** One statement on a connection the caller already holds; never a second checkout. */
type HeldQuery = (text: string) => Promise<{ rows: Array<{ relname: string }> }>;

interface Tripwire {
  /**
   * Undefined: nothing to wait for and nothing wrong. A promise: wait on it, it may reject.
   * `held` is the caller's own connection, on which a cold lookup runs: a client
   * inside a transaction must not check out a second connection while holding
   * one, or concurrent cold starts exhaust the pool waiting on each other.
   */
  inspect(text: string, held?: HeldQuery): Promise<void> | undefined;
}

function createTripwire(mode: UnscopedRlsMode, connect: Connect): Tripwire | undefined {
  if (mode === "ignore") return undefined;

  let tables: Set<string> | null = null;
  let loading: Promise<Set<string>> | null = null;

  // Its own checkout, on the unwrapped connect: this lookup never meets the tripwire.
  const load = (): Promise<Set<string>> =>
    (loading ??= (async () => {
      const client = await connect();
      try {
        const { rows } = await client.query(RLS_TABLES_SQL);
        return (tables = new Set(rows.map((row: { relname: string }) => row.relname.toLowerCase())));
      } finally {
        client.release();
      }
    })().catch((error) => {
      loading = null;
      throw error;
    }));

  const namedTable = (text: string, known: Set<string>): string | undefined => {
    const stripped = text.replace(/'(?:[^']|'')*'/g, "''");
    for (const match of stripped.matchAll(QUOTED_NAME)) {
      if (known.has(match[1].toLowerCase())) return match[1];
    }
    for (const match of stripped.matchAll(BARE_AFTER_KEYWORD)) {
      if (known.has(match[1].toLowerCase())) return match[1];
    }
    return undefined;
  };

  const report = (text: string, known: Set<string>): Promise<void> | undefined => {
    const table = namedTable(text, known);
    if (!table) return undefined;
    if (mode === "throw") return Promise.reject(new UnscopedRlsQueryError(table, text));
    logWarn("workspace.unscoped-rls-query", { table });
    return undefined;
  };

  return {
    inspect(text, held) {
      // The lookup may land on a client this module already wrapped (pooled
      // clients are reused); it must not wait on its own result.
      if (!text || text === RLS_TABLES_SQL || CONTROL_STATEMENT.test(text)) return undefined;
      if (tables) return report(text, tables);
      if (held) {
        return held(RLS_TABLES_SQL).then(({ rows }) => {
          tables ??= new Set(rows.map((row) => row.relname.toLowerCase()));
          return report(text, tables);
        });
      }
      return load().then((known) => report(text, known) ?? undefined);
    },
  };
}

function settle(run: () => Promise<unknown>, callback: unknown): unknown {
  if (callback) {
    run().then(
      (result) => (callback as (err: Error | null, result?: unknown) => void)(null, result),
      (error) => (callback as (err: Error | null) => void)(error as Error)
    );
    return undefined;
  }
  return run();
}

export function bindWorkspaceScope(pool: Queryable, options: WorkspaceScopeOptions = {}): void {
  const tagged = pool as Queryable & { __docuflowScope?: boolean };
  if (tagged.__docuflowScope) return;
  tagged.__docuflowScope = true;

  const connect = pool.connect.bind(pool) as Connect;
  const tripwire = createTripwire(options.onUnscopedRlsQuery ?? "ignore", connect);

  pool.query = ((config: unknown, values?: unknown, cb?: unknown) => {
    const callback = typeof values === "function" ? values : typeof cb === "function" ? cb : undefined;
    const params = typeof values === "function" ? undefined : values;

    const run = async () => {
      if (!readContext()) await tripwire?.inspect(queryTextOf(config));
      const client = await connect();
      // A reused client may already be wrapped; its own statements bypass the
      // wrapper here so the GUC is set, and the tripwire run, exactly once.
      const raw = rawQueryOf(client);
      try {
        await raw("BEGIN");
        try {
          await applyLocalScope(raw);
          const result =
            params === undefined ? await raw(config) : await raw(config, params);
          await raw("COMMIT");
          return result;
        } catch (error) {
          await raw("ROLLBACK");
          throw error;
        }
      } finally {
        client.release();
      }
    };

    return settle(run, callback);
  }) as Queryable["query"];

  pool.connect = ((cb?: (err: Error | null, client?: pg.PoolClient, release?: (err?: unknown) => void) => void) => {
    if (cb) {
      return connect((err, client, release) => {
        if (client) wrapTransactionClient(client, tripwire);
        cb(err, client, release);
      });
    }
    return connect().then((client) => {
      wrapTransactionClient(client, tripwire);
      return client;
    });
  }) as Queryable["connect"];
}

function wrapTransactionClient(client: pg.PoolClient, tripwire: Tripwire | undefined): void {
  const tagged = client as pg.PoolClient & { __docuflowScope?: boolean; __docuflowRawQuery?: RawQuery };
  if (tagged.__docuflowScope) return;
  tagged.__docuflowScope = true;

  const query = client.query.bind(client) as RawQuery;
  tagged.__docuflowRawQuery = query;

  // The Workspace id the open transaction's GUC holds (NO_WORKSPACE when none),
  // or null when unknown: after a ROLLBACK TO, which undoes later set_configs.
  let inTransaction = false;
  let applied: string | null = NO_WORKSPACE;

  const needsRescope = (desired: string) => inTransaction && applied !== desired;

  const rescope = async (desired: string) => {
    applied = desired;
    await query("SELECT set_config($1, $2, true)", [WORKSPACE_GUC, desired]);
  };

  client.query = ((...args: unknown[]) => {
    const [config, values, cb] = args;
    const text = queryTextOf(config);
    const callback = typeof values === "function" ? values : typeof cb === "function" ? cb : undefined;
    const params = typeof values === "function" ? undefined : values;
    const passThrough = () => query(...args);

    if (isBegin(text)) {
      const desired = readContext()?.workspaceId ?? NO_WORKSPACE;
      inTransaction = true;
      applied = desired;
      const run = async () => {
        try {
          const result =
            params === undefined ? await query(config) : await query(config, params);
          if (desired !== NO_WORKSPACE) {
            await query("SELECT set_config($1, $2, true)", [WORKSPACE_GUC, desired]);
          }
          return result;
        } catch (error) {
          inTransaction = false;
          throw error;
        }
      };
      return settle(run, callback);
    }

    if (isTransactionEnd(text)) {
      inTransaction = false;
      applied = NO_WORKSPACE;
      return passThrough();
    }
    if (isRollbackToSavepoint(text)) {
      applied = null;
      return passThrough();
    }
    if (CONTROL_STATEMENT.test(text) || !text) return passThrough();

    const context = readContext();
    const wait = context
      ? undefined
      : tripwire?.inspect(text, (lookup) => query(lookup) as ReturnType<HeldQuery>);
    if (!wait && !needsRescope(context?.workspaceId ?? NO_WORKSPACE)) return passThrough();
    // Awaited, not queued: pg deprecates a second query on a busy client.
    return settle(async () => {
      await wait;
      const desired = readContext()?.workspaceId ?? NO_WORKSPACE;
      if (needsRescope(desired)) await rescope(desired);
      return passThroughPromise(query, config, params);
    }, callback);
  }) as pg.PoolClient["query"];
}

function passThroughPromise(
  query: (...args: unknown[]) => Promise<unknown>,
  config: unknown,
  params: unknown
): Promise<unknown> {
  return params === undefined ? query(config) : query(config, params);
}

type RawQuery = (...args: unknown[]) => Promise<unknown>;

/** The client's own `query`, past this module's wrapper when it has one. */
function rawQueryOf(client: pg.PoolClient): RawQuery {
  const raw = (client as pg.PoolClient & { __docuflowRawQuery?: RawQuery }).__docuflowRawQuery;
  return raw ?? (client.query.bind(client) as unknown as RawQuery);
}

async function applyLocalScope(raw: RawQuery): Promise<void> {
  const ctx = readContext();
  if (!ctx) return;
  await raw("SELECT set_config($1, $2, true)", [WORKSPACE_GUC, ctx.workspaceId]);
}

function queryTextOf(config: unknown): string {
  if (typeof config === "string") return config;
  if (config && typeof config === "object" && "text" in config) {
    const text = (config as { text?: unknown }).text;
    return typeof text === "string" ? text : "";
  }
  return "";
}

function isBegin(text: string): boolean {
  return /^\s*(?:begin|start\s+transaction)\b/i.test(text);
}

function isRollbackToSavepoint(text: string): boolean {
  return /^\s*rollback\s+(?:work\s+|transaction\s+)?to\b/i.test(text);
}

function isTransactionEnd(text: string): boolean {
  return /^\s*(?:commit|end|abort|rollback)\b/i.test(text) && !isRollbackToSavepoint(text);
}

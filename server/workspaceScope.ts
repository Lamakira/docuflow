/**
 * SET LOCAL app.workspace_id on the connection that actually runs the query
 * (#97). Request and Worker work already bind WorkspaceContext on the ALS;
 * this is the database half of that seam. The GUC is local to the transaction
 * so a pooled connection cannot leak one Workspace into the next checkout.
 *
 * The context reader is registered from workspaceContext.ts so this module
 * does not import `server/db.ts` (that file imports us).
 */

import type pg from "pg";

const WORKSPACE_GUC = "app.workspace_id";

type ContextReader = () => { workspaceId: string } | undefined;

let readContext: ContextReader = () => undefined;

export function setWorkspaceContextReader(read: ContextReader): void {
  readContext = read;
}

type Queryable = {
  query: (...args: never[]) => unknown;
  connect: (...args: never[]) => unknown;
  release?: (err?: unknown) => void;
};

export function bindWorkspaceScope(pool: Queryable): void {
  const tagged = pool as Queryable & { __docuflowScope?: boolean };
  if (tagged.__docuflowScope) return;
  tagged.__docuflowScope = true;

  const connect = pool.connect.bind(pool) as {
    (): Promise<pg.PoolClient>;
    (cb: (err: Error | null, client?: pg.PoolClient, release?: (err?: unknown) => void) => void): void;
  };

  pool.query = ((config: unknown, values?: unknown, cb?: unknown) => {
    const callback = typeof values === "function" ? values : typeof cb === "function" ? cb : undefined;
    const params = typeof values === "function" ? undefined : values;

    const run = async () => {
      const client = await connect();
      try {
        await client.query("BEGIN");
        try {
          await applyLocalScope(client);
          const result =
            params === undefined
              ? await client.query(config as never)
              : await client.query(config as never, params as never);
          await client.query("COMMIT");
          return result;
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        }
      } finally {
        client.release();
      }
    };

    if (callback) {
      run().then(
        (result) => (callback as (err: Error | null, result?: unknown) => void)(null, result),
        (error) => (callback as (err: Error | null) => void)(error as Error)
      );
      return undefined;
    }
    return run();
  }) as Queryable["query"];

  pool.connect = ((cb?: (err: Error | null, client?: pg.PoolClient, release?: (err?: unknown) => void) => void) => {
    if (cb) {
      return connect((err, client, release) => {
        if (client) wrapTransactionClient(client);
        cb(err, client, release);
      });
    }
    return connect().then((client) => {
      wrapTransactionClient(client);
      return client;
    });
  }) as Queryable["connect"];
}

function wrapTransactionClient(client: pg.PoolClient): void {
  const tagged = client as pg.PoolClient & { __docuflowScope?: boolean };
  if (tagged.__docuflowScope) return;
  tagged.__docuflowScope = true;

  const query = client.query.bind(client);
  client.query = ((config: unknown, values?: unknown, cb?: unknown) => {
    if (!isBegin(queryTextOf(config))) {
      return query(config as never, values as never, cb as never);
    }

    const callback = typeof values === "function" ? values : typeof cb === "function" ? cb : undefined;
    const params = typeof values === "function" ? undefined : values;

    const run = async () => {
      const result =
        params === undefined
          ? await query(config as never)
          : await query(config as never, params as never);
      await applyLocalScope({ query } as Pick<pg.PoolClient, "query">);
      return result;
    };

    if (callback) {
      run().then(
        (result) => (callback as (err: Error | null, result?: unknown) => void)(null, result),
        (error) => (callback as (err: Error | null) => void)(error as Error)
      );
      return undefined;
    }
    return run();
  }) as pg.PoolClient["query"];
}

async function applyLocalScope(client: Pick<pg.PoolClient, "query">): Promise<void> {
  const ctx = readContext();
  if (!ctx) return;
  await client.query("SELECT set_config($1, $2, true)", [WORKSPACE_GUC, ctx.workspaceId]);
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
  return /^\s*begin\b/i.test(text);
}

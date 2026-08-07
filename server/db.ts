import { Pool as NeonPool, neonConfig } from '@neondatabase/serverless';
import { drizzle as drizzleNeon } from 'drizzle-orm/neon-serverless';
import { drizzle as drizzlePg, type NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import pg from 'pg';
import ws from "ws";
import * as schema from "@shared/schema";
import { config } from "./config";

const { connectionString, driver } = config.database;

/**
 * The pool surface the server actually uses: raw SQL and shutdown. Both pools
 * provide it, but neither is assignable to the other's nominal type —
 * `@neondatabase/serverless` bundles its own copy of pg's typings — so this
 * describes the real shared contract rather than asserting one into the other,
 * and keeps driver-exclusive APIs out of reach.
 */
export interface DbPool {
  query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }>;
  end(): Promise<void>;
}

/**
 * The Drizzle surface the server is written against, and the one both drivers
 * genuinely provide: `NeonDatabase` and `NodePgDatabase` are each a
 * `PgDatabase` over pg's `QueryResult` — `@neondatabase/serverless` re-exports
 * pg's types — so this alias describes either one exactly. Declaring it keeps
 * the type checker live across every consumer instead of asserting a driver
 * into a type it does not have.
 */
export type Db = PgDatabase<NodePgQueryResultHKT, typeof schema>;

// DB_DRIVER=pg selects the standard node-postgres driver for databases the
// Neon serverless (WebSocket) driver cannot reach — local and CI Postgres.
// Default remains the Neon driver used in production. Both satisfy DbPool and
// Db below, so the rest of the server is driver-agnostic by type, not by cast.
const usePg = driver === "pg";

neonConfig.webSocketConstructor = ws;

function createDb(): { pool: DbPool; db: Db } {
  if (usePg) {
    const pgPool = new pg.Pool({ connectionString });
    return { pool: pgPool, db: drizzlePg({ client: pgPool, schema }) };
  }
  const neonPool = new NeonPool({ connectionString });
  return { pool: neonPool, db: drizzleNeon({ client: neonPool, schema }) };
}

const created = createDb();
export const pool = created.pool;
export const db = created.db;

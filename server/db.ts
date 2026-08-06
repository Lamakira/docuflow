import { Pool as NeonPool, neonConfig } from '@neondatabase/serverless';
import { drizzle as drizzleNeon, type NeonDatabase } from 'drizzle-orm/neon-serverless';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import ws from "ws";
import * as schema from "@shared/schema";
import { connectionString } from "./dbConfig";

// DB_DRIVER=pg selects the standard node-postgres driver for databases the
// Neon serverless (WebSocket) driver cannot reach — local and CI Postgres.
// Default remains the Neon driver used in production. Both expose the same
// pool.query and Drizzle APIs, so the rest of the server is driver-agnostic.
const usePg = process.env.DB_DRIVER === "pg";

neonConfig.webSocketConstructor = ws;

function createDb(): { pool: NeonPool; db: NeonDatabase<typeof schema> } {
  if (usePg) {
    const pgPool = new pg.Pool({ connectionString });
    return {
      pool: pgPool as unknown as NeonPool,
      db: drizzlePg({ client: pgPool, schema }) as unknown as NeonDatabase<typeof schema>,
    };
  }
  const neonPool = new NeonPool({ connectionString });
  return { pool: neonPool, db: drizzleNeon({ client: neonPool, schema }) };
}

const created = createDb();
export const pool = created.pool;
export const db = created.db;

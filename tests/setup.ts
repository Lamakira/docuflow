import { afterAll } from "vitest";
import { resolveTestDatabaseUrl } from "./test-db-url";

// Environment must be fixed BEFORE any server module loads — server config
// modules (dbConfig, auth) resolve process.env at import time. Server code is
// therefore only ever imported dynamically, via the helpers in tests/helpers/.
process.env.NODE_ENV = "test";
process.env.TZ = "UTC";
process.env.DATABASE_URL = resolveTestDatabaseUrl();
process.env.DB_DRIVER = "pg"; // local/CI Postgres — Neon serverless driver can't reach it
process.env.SESSION_SECRET ??= "test-session-secret";
process.env.JWT_SECRET ??= "test-jwt-secret";

afterAll(async () => {
  // Close the server's pg pool so the worker exits cleanly.
  const { pool } = await import("../server/db");
  await pool.end().catch(() => {});
});

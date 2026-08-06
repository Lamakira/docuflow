import { afterAll } from "vitest";
import { stopApp } from "./helpers/app";
import { resolveTestDatabaseUrl } from "./test-db-url";

// Environment must be fixed BEFORE any server module loads — server config
// modules (dbConfig, auth) resolve process.env at import time. Server code is
// therefore only ever imported dynamically, via the helpers in tests/helpers/.
process.env.NODE_ENV = "test";
process.env.TZ = "UTC";
process.env.DATABASE_URL = resolveTestDatabaseUrl();
process.env.DB_DRIVER = "pg"; // local/CI Postgres — Neon serverless driver can't reach it
// Assigned, not defaulted (ADR-0018): a developer's real exported secrets must
// never reach the harness, and fixed values keep token assertions deterministic.
process.env.SESSION_SECRET = "test-session-secret";
process.env.JWT_SECRET = "test-jwt-secret";

afterAll(async () => {
  // Stop the app's background dispatchers first: they run on 1–2 minute
  // intervals, so anything slower than that would otherwise keep querying
  // after the pool below closes.
  stopApp();
  // Close the server's pg pool so the worker exits cleanly.
  const { pool } = await import("../server/db");
  await pool.end().catch(() => {});
});

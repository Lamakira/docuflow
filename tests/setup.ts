import { afterAll, beforeEach } from "vitest";
import { stopApp } from "./helpers/app";
import { resolveTestDatabaseUrl } from "./test-db-url";
import { resetGcs } from "./fakes/gcs";
import { resetOpenAi } from "./fakes/openai";
import { resetEmails } from "./fakes/resend";
import { installNetworkFake, resetNetworkFake } from "./fakes/network";

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
process.env.OPENAI_API_KEY = "test-openai-key"; // consumed by the aliased fake, never sent anywhere
// Object-storage layout the fake GCS bucket mirrors. Without these,
// ObjectStorageService throws before it ever reaches the provider.
process.env.PRIVATE_OBJECT_DIR = "/test-bucket/.private";
process.env.PUBLIC_OBJECT_SEARCH_PATHS = "/test-bucket/public";
// Replit connector lookup for Resend credentials — answered by the network fake.
process.env.REPLIT_CONNECTORS_HOSTNAME = "connectors.test.invalid";
process.env.REPL_IDENTITY = "test-repl-identity";
delete process.env.WEB_REPL_RENEWAL;
// Neither the MCP admin bypass in `isAuthenticated` nor the desktop-release CI
// token may be inherited from a developer's shell; each suite sets what it needs.
delete process.env.MCP_API_KEY;
delete process.env.DESKTOP_RELEASE_CI_TOKEN;

installNetworkFake();

beforeEach(() => {
  // Provider fakes are module-level singletons shared by every suite; clear them
  // alongside the database so one test's uploads or emails cannot leak into the next.
  resetGcs();
  resetOpenAi();
  resetEmails();
  resetNetworkFake();
});

afterAll(async () => {
  // Stop the app's background dispatchers first: they run on 1–2 minute
  // intervals, so anything slower than that would otherwise keep querying
  // after the pool below closes.
  stopApp();
  // Close the server's pg pool so the worker exits cleanly.
  const { pool } = await import("../server/db");
  await pool.end().catch(() => {});
});

import { afterAll, beforeEach } from "vitest";
import { stopApp } from "./helpers/app";
import { resolveTestDatabaseUrl } from "./test-db-url";
import { resetGcs } from "./fakes/gcs";
import { resetOpenAi } from "./fakes/openai";
import { resetEmails } from "./fakes/resend";
import { installNetworkFake } from "./fakes/network";

// Environment must be fixed BEFORE any server module loads — `server/config.ts`
// resolves process.env at import time and refuses to boot when a required
// variable is missing. Server code is therefore only ever imported dynamically,
// via the helpers in tests/helpers/.
process.env.NODE_ENV = "test";
process.env.TZ = "UTC";
process.env.DATABASE_URL = resolveTestDatabaseUrl();
process.env.DB_DRIVER = "pg"; // local/CI Postgres — Neon serverless driver can't reach it
// Assigned, not defaulted (ADR-0018): a developer's real exported secrets must
// never reach the harness, and fixed values keep token assertions deterministic.
process.env.SESSION_SECRET = "test-session-secret";
process.env.JWT_SECRET = "test-jwt-secret";
process.env.OPENAI_API_KEY = "test-openai-key"; // consumed by the aliased fake, never sent anywhere
// Object-storage layout the fake GCS bucket mirrors. Without these, config
// refuses to boot. No GCS credentials: the SDK is aliased away, so a suite that
// somehow reached the real client would fail rather than authenticate.
process.env.PRIVATE_OBJECT_DIR = "/test-bucket/.private";
process.env.PUBLIC_OBJECT_SEARCH_PATHS = "/test-bucket/public";
delete process.env.GCS_SERVICE_ACCOUNT_KEY;
// Email credentials, consumed by the aliased fake and never sent anywhere. The
// from address is fixed here because it is what the suites see in the outbox.
process.env.RESEND_API_KEY = "test-resend-key";
process.env.RESEND_FROM_EMAIL = "DocuFlow <noreply@docuflow.test>";
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

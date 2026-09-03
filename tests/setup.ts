import { afterAll, beforeEach } from "vitest";
import { stopApp } from "./helpers/app";
import { resolveTestDatabaseUrl } from "./test-db-url";
import { resetGcs } from "./fakes/gcs";
import { resetOpenAi } from "./fakes/openai";
import { resetEmails } from "./fakes/resend";
import { resetStripe } from "./fakes/stripe";
import { resetClerk } from "./fakes/clerk";
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
// `<key-id>:<secret>`; the id is what a token's header names. No previous key —
// the harness runs the steady state, and `tests/smoke/desktop-tokens.test.ts` is
// where a rotation's two-key window is set up and exercised.
process.env.JWT_SECRET = "test-key-1:test-jwt-signing-secret-for-the-harness";
delete process.env.JWT_PREVIOUS_SECRET;
process.env.OPENAI_API_KEY = "test-openai-key"; // consumed by the aliased fake, never sent anywhere
// Object-storage layout the fake GCS bucket mirrors. Without these, config
// refuses to boot, and it likewise refuses to boot without a credential — so one
// is named, but no credential material is put in the harness: the path does not
// exist and the SDK is aliased away, so a suite that somehow reached the real
// client would fail rather than authenticate.
process.env.PRIVATE_OBJECT_DIR = "/test-bucket/.private";
process.env.PUBLIC_OBJECT_SEARCH_PATHS = "/test-bucket/public";
process.env.GOOGLE_APPLICATION_CREDENTIALS = "/nonexistent/test-service-account.json";
delete process.env.GCS_SERVICE_ACCOUNT_KEY;
// Email credentials, consumed by the aliased fake and never sent anywhere. The
// from address is fixed here because it is what the suites see in the outbox.
process.env.RESEND_API_KEY = "test-resend-key";
process.env.RESEND_FROM_EMAIL = "DocuFlow <noreply@docuflow.test>";
// Neither the MCP admin bypass in `isAuthenticated` nor the desktop-release CI
// token may be inherited from a developer's shell; each suite sets what it needs.
delete process.env.MCP_API_KEY;
delete process.env.DESKTOP_RELEASE_CI_TOKEN;
// Live Stripe credentials must not reach the harness (ADR-0018). Missing
// credentials are the default: Entitlement reads still succeed, Checkout fails closed.
delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_WEBHOOK_SECRET;
delete process.env.STRIPE_PRICE_PRO;
// Test-mode Clerk credentials, consumed by the aliased fake and never sent
// anywhere (ADR-0018) — assigned rather than deleted since #110, because web
// sign-in is now the IdentityProvider and `tests/helpers/auth.ts` signs every
// User in through it. A developer's real keys are overwritten, not inherited.
process.env.CLERK_SECRET_KEY = "sk_test_harness-identity-provider";
process.env.CLERK_PUBLISHABLE_KEY = "pk_test_harness-identity-provider";
// Likewise the browser the transcript scraper would launch (#37): a developer
// with PLAYWRIGHT_CHROMIUM_PATH exported would otherwise run these suites with
// launch options no other machine produces.
delete process.env.PLAYWRIGHT_CHROMIUM_PATH;
// Telemetry is off under NODE_ENV=test by default (#26), but a developer with an
// OTEL_* variable exported would otherwise instrument their own test run and
// ship its spans somewhere. The harness decides, not the shell.
// Telemetry is off under NODE_ENV=test by default (#26), but a developer with an
// OTEL_* variable exported would otherwise instrument their own test run and
// ship its spans somewhere. The harness decides, not the shell.
for (const name of Object.keys(process.env)) {
  if (name.startsWith("OTEL_")) delete process.env[name];
}
delete process.env.DOCUFLOW_ROLE;
delete process.env.DOCUFLOW_HTTP_BACKGROUND_INTERVALS;

installNetworkFake();

beforeEach(() => {
  // The flag that reads IdentityProvider sessions (#109) is what web sign-in
  // rides on after the #110 cutover, so the harness runs with it on and a case
  // that wants the rollback surface turns it off for itself. Restored per test
  // rather than set once, so that case cannot leak into the next one.
  //
  // This is why nothing runs in the flag's own default any more: with the flag
  // off there is no way to sign a User in at all, which is the cutover, not an
  // accident. `tests/smoke/config.test.ts` builds its own environment and is
  // where the default-off behaviour is still proven.
  process.env.DOCUFLOW_IDENTITY_DUAL_AUTH = "on";
  // Provider fakes are module-level singletons shared by every suite; clear them
  // alongside the database so one test's uploads or emails cannot leak into the next.
  resetGcs();
  resetOpenAi();
  resetEmails();
  resetStripe();
  resetClerk();
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

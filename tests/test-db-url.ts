/**
 * Resolve the test database URL, defaulting to the docker-compose.test.yml
 * Postgres. Guard (ADR-0018): tests refuse any non-local database unless
 * ALLOW_REMOTE_TEST_DB=1 is set explicitly — production or shared databases
 * must never be reachable from the harness, which truncates every table.
 */
export function resolveTestDatabaseUrl(): string {
  const url =
    process.env.TEST_DATABASE_URL ??
    "postgresql://postgres:postgres@localhost:5433/docuflow_test";

  const host = new URL(url).hostname;
  const isLocal = host === "localhost" || host === "127.0.0.1" || host === "::1";
  if (!isLocal && process.env.ALLOW_REMOTE_TEST_DB !== "1") {
    throw new Error(
      `Refusing to run tests against non-local database host "${host}". ` +
        `The harness truncates all tables. Set ALLOW_REMOTE_TEST_DB=1 only for a ` +
        `disposable remote test database that contains nothing you want to keep.`
    );
  }
  return url;
}

/**
 * The application role the harness runs the server as (#323). Row-level
 * security applies to it, so a query that forgets its Workspace context fails
 * in the suite instead of in production. `tests/global-setup.ts` gives the role
 * this password; fixtures that must bypass RLS use the owner URL instead.
 */
export const TEST_APP_ROLE = "docuflow_app";
export const TEST_APP_ROLE_PASSWORD = "rls-harness";

/** The test database, reached as `docuflow_app`. */
export function resolveTestAppDatabaseUrl(): string {
  const url = new URL(resolveTestDatabaseUrl());
  url.username = TEST_APP_ROLE;
  url.password = TEST_APP_ROLE_PASSWORD;
  return url.toString();
}

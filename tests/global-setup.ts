import { migrate } from "../scripts/migrate";
import pg from "pg";
import { TEST_APP_ROLE, TEST_APP_ROLE_PASSWORD, resolveTestDatabaseUrl } from "./test-db-url";

/**
 * Runs once before the test suite: build the test database by applying the
 * migration journal, exactly as a deploy does (#24). The harness deliberately
 * shares `scripts/migrate.ts` with production rather than pushing the schema
 * from `shared/schema.ts` — a second path to a schema is a second thing to
 * drift, and a journal that only production runs is a journal nothing tests.
 *
 * The server then runs as `docuflow_app` (#323), the role row-level security
 * applies to; migration 0010 creates it without a password, so it gets one here.
 *
 * `tests/smoke/migrations.test.ts` is what checks the journal still agrees with
 * `shared/schema.ts`.
 */
export default async function globalSetup(): Promise<void> {
  await migrate(resolveTestDatabaseUrl());
  const owner = new pg.Client({ connectionString: resolveTestDatabaseUrl() });
  await owner.connect();
  try {
    await owner.query(
      `ALTER ROLE ${TEST_APP_ROLE} WITH PASSWORD ${pg.escapeLiteral(TEST_APP_ROLE_PASSWORD)}`
    );
  } finally {
    await owner.end();
  }
}

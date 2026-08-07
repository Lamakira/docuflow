import { migrate } from "../scripts/migrate";
import { resolveTestDatabaseUrl } from "./test-db-url";

/**
 * Runs once before the test suite: build the test database by applying the
 * migration journal, exactly as a deploy does (#24). The harness deliberately
 * shares `scripts/migrate.ts` with production rather than pushing the schema
 * from `shared/schema.ts` — a second path to a schema is a second thing to
 * drift, and a journal that only production runs is a journal nothing tests.
 *
 * `tests/smoke/migrations.test.ts` is what checks the journal still agrees with
 * `shared/schema.ts`.
 */
export default async function globalSetup(): Promise<void> {
  await migrate(resolveTestDatabaseUrl());
}

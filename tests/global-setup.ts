import { execFileSync } from "child_process";
import { resolveTestDatabaseUrl } from "./test-db-url";

/**
 * Runs once before the test suite: create/update the schema in the test
 * database from shared/schema.ts. Uses drizzle-kit push (schema-as-truth)
 * until the migration journal is consolidated (#24), after which this can
 * switch to running the journal.
 */
export default function globalSetup(): void {
  const url = resolveTestDatabaseUrl();
  execFileSync("npx", ["drizzle-kit", "push", "--force"], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "inherit",
  });
}

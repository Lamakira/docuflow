import { execFileSync } from "child_process";
import { Client } from "pg";
import { resolveTestDatabaseUrl } from "./test-db-url";

/**
 * Vector columns the running database has but `shared/schema.ts` does not declare.
 *
 * `document_embeddings.embedding` and `company_document_embeddings.embedding` are
 * written and ordered by through raw SQL in `server/embeddings.ts`, yet no Drizzle
 * column or committed migration creates them — they were applied out of band. A
 * schema push alone therefore produces a database where every embedding write
 * fails, which would make the retrieval suites characterize a local accident
 * instead of the real contract. Recreate them here until #24 folds the DDL into
 * the migration journal.
 */
const OUT_OF_BAND_DDL = `
  CREATE EXTENSION IF NOT EXISTS vector;
  ALTER TABLE document_embeddings
    ADD COLUMN IF NOT EXISTS embedding vector(1536);
  ALTER TABLE company_document_embeddings
    ADD COLUMN IF NOT EXISTS embedding vector(1536);
`;

/**
 * Runs once before the test suite: create/update the schema in the test
 * database from shared/schema.ts. Uses drizzle-kit push (schema-as-truth)
 * until the migration journal is consolidated (#24), after which this can
 * switch to running the journal.
 */
export default async function globalSetup(): Promise<void> {
  const url = resolveTestDatabaseUrl();
  execFileSync("npx", ["drizzle-kit", "push", "--force"], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "inherit",
  });

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(OUT_OF_BAND_DDL);
  } finally {
    await client.end();
  }
}

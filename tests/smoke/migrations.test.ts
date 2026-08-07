import { execFileSync } from "node:child_process";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadMigrations, migrate } from "../../scripts/migrate";
import { resolveTestDatabaseUrl } from "../test-db-url";

/**
 * The journal is the only way a database gets its schema (#24), which puts two
 * things at risk that nothing else in the harness would catch:
 *
 *  - the journal drifting from `shared/schema.ts`, the source every Drizzle
 *    query is typed against. A migration someone forgot to generate makes the
 *    server query a column the database does not have.
 *  - the runner itself. Every other suite runs against a database it already
 *    built, so a runner that skipped a migration, or applied one twice, would
 *    look like a passing run.
 *
 * So: build one database from the journal, build another with `drizzle-kit
 * push` — the schema file, applied directly — and diff the two.
 */

const TEST_DB_URL = resolveTestDatabaseUrl();

/** A throwaway database on the same server, created and dropped per run. */
const SCRATCH_DB = "docuflow_schema_diff";

function urlForDatabase(name: string): string {
  const url = new URL(TEST_DB_URL);
  url.pathname = `/${name}`;
  return url.toString();
}

async function withClient<T>(url: string, use: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await use(client);
  } finally {
    await client.end();
  }
}

/**
 * Columns with their real types — `format_type` renders the type modifier, so
 * `varchar(255)` and `vector(1536)` compare as themselves rather than collapsing
 * into `character varying` and `USER-DEFINED` the way `information_schema` does.
 *
 * Sorted by name, not by position: a column appended by `ALTER TABLE` lands last
 * while the same column in a `CREATE TABLE` sits wherever the schema file
 * declares it, and that difference means nothing.
 */
const COLUMNS_SQL = `
  SELECT c.relname AS table_name,
         a.attname AS column_name,
         format_type(a.atttypid, a.atttypmod) AS type,
         a.attnotnull AS not_null,
         pg_get_expr(d.adbin, d.adrelid) AS default_expr
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND c.relname <> 'schema_migrations'
  ORDER BY c.relname, a.attname
`;

const INDEXES_SQL = `
  SELECT tablename, indexname, indexdef
  FROM pg_indexes
  WHERE schemaname = 'public' AND tablename <> 'schema_migrations'
  ORDER BY tablename, indexname
`;

/** Primary keys, foreign keys, uniques, and checks, as Postgres renders them. */
const CONSTRAINTS_SQL = `
  SELECT c.conrelid::regclass::text AS table_name,
         c.conname,
         pg_get_constraintdef(c.oid) AS definition
  FROM pg_constraint c
  JOIN pg_namespace n ON n.oid = c.connamespace
  WHERE n.nspname = 'public'
    AND c.conrelid::regclass::text <> 'schema_migrations'
  ORDER BY 1, 2
`;

async function describeSchema(url: string) {
  return withClient(url, async (client) => ({
    columns: (await client.query(COLUMNS_SQL)).rows,
    indexes: (await client.query(INDEXES_SQL)).rows,
    constraints: (await client.query(CONSTRAINTS_SQL)).rows,
  }));
}

describe("migration journal", () => {
  beforeAll(async () => {
    await withClient(urlForDatabase("postgres"), async (client) => {
      await client.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB}`);
      await client.query(`CREATE DATABASE ${SCRATCH_DB}`);
    });

    // `drizzle-kit push` emits the columns but never the extension they need —
    // it has no notion of one. That gap is precisely why the vector DDL was
    // applied out of band for so long, and why migration 0003 carries a
    // hand-written `CREATE EXTENSION` line.
    await withClient(urlForDatabase(SCRATCH_DB), (client) =>
      client.query("CREATE EXTENSION IF NOT EXISTS vector")
    );

    execFileSync("npx", ["drizzle-kit", "push", "--force"], {
      env: { ...process.env, DATABASE_URL: urlForDatabase(SCRATCH_DB) },
      stdio: "pipe",
    });
  }, 120_000);

  afterAll(async () => {
    await withClient(urlForDatabase("postgres"), (client) =>
      client.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB}`)
    );
  });

  it("builds the same schema shared/schema.ts declares", async () => {
    // The journal database is the one the whole suite runs against, built by
    // tests/global-setup.ts through the same runner a deploy uses.
    const fromJournal = await describeSchema(TEST_DB_URL);
    const fromSchemaFile = await describeSchema(urlForDatabase(SCRATCH_DB));

    expect(fromJournal.columns).toEqual(fromSchemaFile.columns);
    expect(fromJournal.indexes).toEqual(fromSchemaFile.indexes);
    expect(fromJournal.constraints).toEqual(fromSchemaFile.constraints);
  });

  it("records every migration it applied, once", async () => {
    const applied = await withClient(TEST_DB_URL, (client) =>
      client.query<{ version: string }>(
        `SELECT version FROM schema_migrations ORDER BY version`
      )
    );

    expect(applied.rows.map((row) => row.version)).toEqual(
      loadMigrations().map((migration) => migration.version)
    );
  });

  it("is a no-op once applied", async () => {
    const ran = await migrate(TEST_DB_URL);
    expect(ran).toEqual([]);
  });

  it("baselines a database that predates the journal", async () => {
    // The production cutover: a schema built by `drizzle-kit push`, with no
    // migration record at all. Baselining through 0002 records the history it
    // already has without running it, and leaves 0003 to apply normally.
    const scratch = urlForDatabase(SCRATCH_DB);

    const ran = await migrate(scratch, { baselineThrough: "0002_slimy_whirlwind" });

    expect(ran).toEqual(["0003_vector_embeddings"]);
    const ledger = await withClient(scratch, (client) =>
      client.query<{ version: string; baselined: boolean }>(
        `SELECT version, baselined FROM schema_migrations ORDER BY version`
      )
    );
    expect(ledger.rows).toEqual([
      { version: "0000_fair_amazoness", baselined: true },
      { version: "0001_dashing_rick_jones", baselined: true },
      { version: "0002_slimy_whirlwind", baselined: true },
      { version: "0003_vector_embeddings", baselined: false },
    ]);
  });

  it("refuses to run when an applied migration's file has changed", async () => {
    const [first] = loadMigrations();
    await withClient(TEST_DB_URL, (client) =>
      client.query(`UPDATE schema_migrations SET checksum = 'tampered' WHERE version = $1`, [
        first.version,
      ])
    );

    try {
      await expect(migrate(TEST_DB_URL)).rejects.toThrow(/no longer match their files/);
    } finally {
      await withClient(TEST_DB_URL, (client) =>
        client.query(`UPDATE schema_migrations SET checksum = $2 WHERE version = $1`, [
          first.version,
          first.checksum,
        ])
      );
    }
  });
});

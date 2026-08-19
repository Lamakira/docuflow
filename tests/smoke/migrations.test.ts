import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { describeSchema } from "../../scripts/lib/schemaSnapshot";
import { loadMigrations, migrate } from "../../scripts/migrate";
import { urlForDatabase, withClient } from "../helpers/db";
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
 *
 * What this cannot catch, by construction: DDL that reached a real database
 * without passing through this repository. Both sides here are built from the
 * repository, so a column that exists only in production is in neither. That is
 * `npm run db:verify` (`scripts/verify-schema.ts`), which diffs the journal
 * against a live database instead.
 */

const TEST_DB_URL = resolveTestDatabaseUrl();

/** A throwaway database on the same server, created and dropped per run. */
const SCRATCH_DB = "docuflow_schema_diff";

/** The same introspection `npm run db:verify` runs, so the two cannot disagree. */
async function describeDatabase(url: string) {
  return withClient(url, describeSchema);
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
    const fromJournal = await describeDatabase(TEST_DB_URL);
    const fromSchemaFile = await describeDatabase(urlForDatabase(SCRATCH_DB));

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
    // already has without running it, and leaves everything after it to apply
    // normally — as no-ops here, since `push` already built what they add.
    const scratch = urlForDatabase(SCRATCH_DB);

    const ran = await migrate(scratch, { baselineThrough: "0002_slimy_whirlwind" });

    expect(ran).toEqual([
      "0003_vector_embeddings",
      "0004_time_entries_task_id_index",
      "0005_jobs",
      "0006_square_wild_child",
      "0007_dark_sasquatch",
      "0008_giant_quasar",
      "0009_flaky_vermin",
    ]);
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
      { version: "0004_time_entries_task_id_index", baselined: false },
      { version: "0005_jobs", baselined: false },
      { version: "0006_square_wild_child", baselined: false },
      { version: "0007_dark_sasquatch", baselined: false },
      { version: "0008_giant_quasar", baselined: false },
      { version: "0009_flaky_vermin", baselined: false },
    ]);
  });

  it("creates nothing under --status or --dry-run", async () => {
    // Both modes promise to change nothing, and the ledger table is part of
    // "nothing": pointed at a database you are only asking about, neither may
    // leave a `schema_migrations` behind. An empty database is where that shows.
    const probe = "docuflow_readonly_probe";
    await withClient(urlForDatabase("postgres"), async (client) => {
      await client.query(`DROP DATABASE IF EXISTS ${probe}`);
      await client.query(`CREATE DATABASE ${probe}`);
    });
    const probeUrl = urlForDatabase(probe);

    try {
      const reported: string[] = [];
      const say = (message: string) => reported.push(message);

      await migrate(probeUrl, { status: true }, say);
      await migrate(probeUrl, { dryRun: true }, say);
      await migrate(probeUrl, { baselineThrough: "0002_slimy_whirlwind", dryRun: true }, say);

      // It still describes the database correctly: everything is pending, and
      // the baseline is reported as something a real run would do.
      expect(reported).toContain("pending  0000_fair_amazoness");
      expect(reported).toContain("would baseline 0000_fair_amazoness (record, not run)");
      expect(reported).toContain("would apply 0003_vector_embeddings (3 statements)");

      const ledger = await withClient(probeUrl, (client) =>
        client.query<{ present: boolean }>(
          `SELECT to_regclass('public.schema_migrations') IS NOT NULL AS present`
        )
      );
      expect(ledger.rows[0].present).toBe(false);
    } finally {
      await withClient(urlForDatabase("postgres"), (client) =>
        client.query(`DROP DATABASE IF EXISTS ${probe}`)
      );
    }
  }, 30_000);

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

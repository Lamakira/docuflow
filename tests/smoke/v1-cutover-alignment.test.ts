import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { describeSchema } from "../../scripts/lib/schemaSnapshot";
import { loadMigrations, migrate } from "../../scripts/migrate";
import { urlForDatabase, withClient } from "../helpers/db";
import { resolveTestDatabaseUrl } from "../test-db-url";

/**
 * The v1 production cutover (#355): v1 is 0000 minus `project_daily_updates`.
 * `migrations/cutover/v1-project-daily-updates.sql` recreates the table, then
 * the database is baselined through 0000. These tests keep that file identical
 * to 0000's statements and prove the whole procedure ends on the journal schema.
 */

const MIGRATIONS = join(__dirname, "..", "..", "migrations");
const CUTOVER_FILE = join(MIGRATIONS, "cutover", "v1-project-daily-updates.sql");
const SCRATCH_DB = "docuflow_v1_cutover";
const TEST_DB_URL = resolveTestDatabaseUrl();

const normalise = (statement: string) => statement.replace(/\s+/g, " ").trim();

function cutoverStatements(): string[] {
  const body = readFileSync(CUTOVER_FILE, "utf8")
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  return body
    .split(";")
    .map(normalise)
    .filter((s) => s && s !== "BEGIN" && s !== "COMMIT");
}

function zeroStatements(): string[] {
  return readFileSync(join(MIGRATIONS, "0000_fair_amazoness.sql"), "utf8")
    .split("--> statement-breakpoint")
    .map((s) => normalise(s.trim().replace(/;$/, "")))
    .filter((s) => s.includes('"project_daily_updates"'));
}

describe("v1 cutover file", () => {
  it("holds exactly 0000's project_daily_updates statements", () => {
    const expected = zeroStatements();
    expect(expected).toHaveLength(7);
    expect(cutoverStatements()).toEqual(expected);
  });

  describe("against a scratch database", () => {
    beforeAll(async () => {
      await withClient(urlForDatabase("postgres"), async (client) => {
        await client.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB}`);
        await client.query(`CREATE DATABASE ${SCRATCH_DB}`);
      });
      await withClient(urlForDatabase(SCRATCH_DB), async (client) => {
        await client.query("CREATE EXTENSION IF NOT EXISTS vector");
        const zero = readFileSync(join(MIGRATIONS, "0000_fair_amazoness.sql"), "utf8");
        for (const statement of zero.split("--> statement-breakpoint")) {
          if (statement.trim()) await client.query(statement);
        }
        // v1: everything 0000 declares, except this table.
        await client.query(`DROP TABLE "project_daily_updates"`);
      });
    }, 60_000);

    afterAll(async () => {
      await withClient(urlForDatabase("postgres"), (client) =>
        client.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB}`)
      );
    });

    it("baselines through 0000 and ends on the journal schema", async () => {
      const scratch = urlForDatabase(SCRATCH_DB);
      await withClient(scratch, (client) =>
        client.query(readFileSync(CUTOVER_FILE, "utf8"))
      );

      const ran = await migrate(scratch, { baselineThrough: "0000_fair_amazoness" });
      const migrations = loadMigrations();
      expect(ran).toEqual(migrations.slice(1).map((m) => m.version));

      const ledger = await withClient(scratch, (client) =>
        client.query<{ version: string; baselined: boolean }>(
          `SELECT version, baselined FROM schema_migrations ORDER BY version`
        )
      );
      expect(ledger.rows).toEqual(
        migrations.map((m, i) => ({ version: m.version, baselined: i === 0 }))
      );

      const fromScratch = await withClient(scratch, describeSchema);
      const fromJournal = await withClient(TEST_DB_URL, describeSchema);
      expect(fromScratch.columns).toEqual(fromJournal.columns);
      expect(fromScratch.indexes).toEqual(fromJournal.indexes);
      expect(fromScratch.constraints).toEqual(fromJournal.constraints);
    }, 60_000);
  });
});

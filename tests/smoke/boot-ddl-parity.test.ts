import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { describeSchema, onlyTables } from "../../scripts/lib/schemaSnapshot";
import { migrate } from "../../scripts/migrate";
import { resolveTestDatabaseUrl } from "../test-db-url";

/**
 * #24 asks for one thing that nothing else in the harness can check: that a
 * database built from the journal alone is *the same database* boot used to
 * produce. Boot created six objects itself, every start, with `CREATE TABLE IF
 * NOT EXISTS` — `tasks`, `devices`, the three `agent_*` tables, and
 * `time_entries.task_id`. The journal now claims to create them instead.
 *
 * That claim cannot be verified against the code, because the same branch that
 * makes it deletes the code it is about. So the boot DDL is kept here verbatim,
 * as the historical record it is, and this suite runs it: build a database from
 * the journal, remove exactly the objects boot owned, let the old boot DDL
 * recreate them, and compare the two shapes.
 *
 * Names of constraints and indexes are excluded from the comparison and their
 * definitions are not. Postgres names an inline `REFERENCES` constraint one way
 * and `drizzle-kit generate` names the identical constraint another; nothing in
 * the application refers to either name, while every one of those definitions is
 * a rule the database enforces on data the application writes.
 *
 * The SQL below is `git show fb400a3:server/index.ts`. It is frozen: if the
 * journal changes these tables, this file does not follow — the new shape is
 * compared against what boot really produced, which is the whole point.
 */

/** Verbatim `ensureTasksMigration()`, deleted from `server/index.ts` by #24. */
const BOOT_TASKS_DDL = `
    CREATE TABLE IF NOT EXISTS tasks (
      id             VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      crm_project_id VARCHAR NOT NULL REFERENCES crm_projects(id) ON DELETE CASCADE,
      name           VARCHAR(255) NOT NULL,
      description    TEXT,
      status         VARCHAR(20) NOT NULL DEFAULT 'open',
      created_at     TIMESTAMP DEFAULT NOW(),
      updated_at     TIMESTAMP DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_crm_project ON tasks(crm_project_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_status      ON tasks(status);
    ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS task_id VARCHAR REFERENCES tasks(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_time_entries_task_id ON time_entries(task_id);
`;

/** Verbatim `ensureAgentTables()`, deleted from `server/index.ts` by #24. */
const BOOT_AGENT_DDL = `
    CREATE TABLE IF NOT EXISTS "devices" (
      "id"                varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "user_id"           varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "name"              varchar(255) NOT NULL,
      "os"                varchar(100),
      "client_version"    varchar(50),
      "device_token_hash" varchar(64) NOT NULL,
      "last_seen_at"      timestamp,
      "revoked_at"        timestamp,
      "created_at"        timestamp DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS "idx_devices_user"       ON "devices"("user_id");
    CREATE INDEX IF NOT EXISTS "idx_devices_token_hash" ON "devices"("device_token_hash");

    CREATE TABLE IF NOT EXISTS "agent_pairing_codes" (
      "id"         varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "user_id"    varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "code"       varchar(10) NOT NULL UNIQUE,
      "expires_at" timestamp NOT NULL,
      "used_at"    timestamp,
      "created_at" timestamp DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS "idx_pairing_code" ON "agent_pairing_codes"("code");

    CREATE TABLE IF NOT EXISTS "agent_processed_batches" (
      "batch_id"     varchar PRIMARY KEY,
      "device_id"    varchar NOT NULL REFERENCES "devices"("id") ON DELETE CASCADE,
      "event_count"  integer NOT NULL DEFAULT 0,
      "processed_at" timestamp DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS "idx_processed_batches_device" ON "agent_processed_batches"("device_id");
    CREATE INDEX IF NOT EXISTS "idx_processed_batches_time"   ON "agent_processed_batches"("processed_at");

    CREATE TABLE IF NOT EXISTS "agent_activity_events" (
      "id"            varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "device_id"     varchar NOT NULL REFERENCES "devices"("id") ON DELETE CASCADE,
      "user_id"       varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "time_entry_id" varchar REFERENCES "time_entries"("id") ON DELETE SET NULL,
      "batch_id"      varchar NOT NULL,
      "event_type"    varchar(50) NOT NULL,
      "timestamp"     timestamp NOT NULL,
      "data"          jsonb,
      "created_at"    timestamp DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS "idx_agent_events_device"    ON "agent_activity_events"("device_id");
    CREATE INDEX IF NOT EXISTS "idx_agent_events_user_time" ON "agent_activity_events"("user_id", "timestamp");
    CREATE INDEX IF NOT EXISTS "idx_agent_events_batch"     ON "agent_activity_events"("batch_id");
`;

/** The tables boot created. Dropped and rebuilt by the boot DDL below. */
const BOOT_OWNED_TABLES = [
  "tasks",
  "devices",
  "agent_pairing_codes",
  "agent_processed_batches",
  "agent_activity_events",
] as const;

/** Boot also added one column to a table it did not own. */
const BOOT_OWNED_COLUMN = { table: "time_entries", column: "task_id" } as const;

const TEST_DB_URL = resolveTestDatabaseUrl();
const SCRATCH_DB = "docuflow_boot_ddl";

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

/** Definitions only, sorted — the shape without the names Postgres chose for it. */
function definitions(rows: { table_name: string; definition: string }[]): string[] {
  return rows.map((row) => `${row.table_name}: ${row.definition}`).sort();
}

/** `CREATE INDEX name ON …` → `CREATE INDEX <name> ON …`, for the same reason. */
function indexDefinitions(rows: { table_name: string; index_name: string; definition: string }[]): string[] {
  return rows
    .map((row) => `${row.table_name}: ${row.definition.replace(row.index_name, "<name>")}`)
    .sort();
}

describe("the journal reproduces what boot-time DDL produced", () => {
  beforeAll(async () => {
    await withClient(urlForDatabase("postgres"), async (client) => {
      await client.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB}`);
      await client.query(`CREATE DATABASE ${SCRATCH_DB}`);
    });

    await migrate(urlForDatabase(SCRATCH_DB));

    await withClient(urlForDatabase(SCRATCH_DB), async (client) => {
      // Unmake exactly what boot made, leaving everything it depended on.
      await client.query(
        `ALTER TABLE ${BOOT_OWNED_COLUMN.table} DROP COLUMN IF EXISTS ${BOOT_OWNED_COLUMN.column}`
      );
      for (const table of BOOT_OWNED_TABLES) {
        await client.query(`DROP TABLE IF EXISTS "${table}" CASCADE`);
      }

      // Then let the old boot code make it again.
      await client.query(BOOT_TASKS_DDL);
      await client.query(BOOT_AGENT_DDL);
    });
  }, 120_000);

  afterAll(async () => {
    await withClient(urlForDatabase("postgres"), (client) =>
      client.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB}`)
    );
  });

  it("declares the same columns boot did", async () => {
    const compared = [...BOOT_OWNED_TABLES, BOOT_OWNED_COLUMN.table];
    const fromJournal = onlyTables(await withClient(TEST_DB_URL, describeSchema), compared);
    const fromBoot = onlyTables(await withClient(urlForDatabase(SCRATCH_DB), describeSchema), compared);

    expect(fromJournal.columns).toEqual(fromBoot.columns);
  });

  it("enforces the same constraints boot did", async () => {
    const compared = [...BOOT_OWNED_TABLES, BOOT_OWNED_COLUMN.table];
    const fromJournal = onlyTables(await withClient(TEST_DB_URL, describeSchema), compared);
    const fromBoot = onlyTables(await withClient(urlForDatabase(SCRATCH_DB), describeSchema), compared);

    expect(definitions(fromJournal.constraints)).toEqual(definitions(fromBoot.constraints));
  });

  it("carries the same indexes boot did", async () => {
    const compared = [...BOOT_OWNED_TABLES, BOOT_OWNED_COLUMN.table];
    const fromJournal = onlyTables(await withClient(TEST_DB_URL, describeSchema), compared);
    const fromBoot = onlyTables(await withClient(urlForDatabase(SCRATCH_DB), describeSchema), compared);

    expect(indexDefinitions(fromJournal.indexes)).toEqual(indexDefinitions(fromBoot.indexes));
  });
});

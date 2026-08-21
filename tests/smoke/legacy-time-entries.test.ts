import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/migrate";
import { urlForDatabase, withClient } from "../helpers/db";

/**
 * Phase 6 ticket #117: existing Time Entries keep their rows and receive
 * provenance `legacy`. No Timer Command is synthesized for them (ADR-0009,
 * Spec #112). HTTP is not this suite — the journal is the seam.
 */

const SCRATCH_DB = "docuflow_legacy_time_entries";
const BEFORE_STAMP = "0014_cooing_goblin_queen";
const ENTRY_ID = "te-keep";

describe("stamp legacy Time Entries", () => {
  let scratch: string;

  beforeAll(async () => {
    await withClient(urlForDatabase("postgres"), async (client) => {
      await client.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB}`);
      await client.query(`CREATE DATABASE ${SCRATCH_DB}`);
    });
    scratch = urlForDatabase(SCRATCH_DB);

    await migrate(scratch, { applyThrough: BEFORE_STAMP });
    await withClient(scratch, async (client) => {
      await client.query(
        `INSERT INTO users (id, email, password, role, is_main_admin, created_at)
         VALUES ('u-keep', 'keep@example.test', 'x', 'user', 0, '2020-01-01')`
      );
      await client.query(
        `INSERT INTO projects (id, name, owner_id, workspace_id)
         VALUES ('p-keep', 'Atlas', 'u-keep', 'seeded')`
      );
      await client.query(
        `INSERT INTO crm_projects (id, project_id, status, project_status, project_type, workspace_id)
         VALUES ('crm-keep', 'p-keep', 'won_in_progress', 'active', 'one_time', 'seeded')`
      );
      await client.query(
        `INSERT INTO time_entries (
           id, user_id, crm_project_id, description, start_time, end_time,
           duration, idle_time, status, workspace_id
         ) VALUES (
           '${ENTRY_ID}', 'u-keep', 'crm-keep', 'Historical work',
           '2026-01-15 10:00:00', '2026-01-15 11:00:00',
           3600, 0, 'stopped', 'seeded'
         )`
      );
    });
    await migrate(scratch);
  }, 120_000);

  afterAll(async () => {
    await withClient(urlForDatabase("postgres"), (client) =>
      client.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB}`)
    );
  });

  it("keeps the historical Time Entry listed with provenance legacy and no Timer Command", async () => {
    const tables = await withClient(scratch, async (client) => {
      const { rows } = await client.query<{ tablename: string }>(
        `SELECT tablename FROM pg_tables
          WHERE schemaname = 'public'
            AND tablename NOT LIKE '\\_\\_drizzle%'
          ORDER BY tablename`
      );
      return rows.map((row) => row.tablename);
    });
    expect(tables).toContain("timer_commands");
    expect(tables).toContain("time_entries");

    const entry = await withClient(scratch, async (client) => {
      const { rows } = await client.query<{
        id: string;
        description: string;
        provenance: string;
        timer_command_id: string | null;
      }>(
        `SELECT id, description, provenance, timer_command_id
           FROM time_entries WHERE id = $1`,
        [ENTRY_ID]
      );
      return rows[0];
    });
    expect(entry).toMatchObject({
      id: ENTRY_ID,
      description: "Historical work",
      provenance: "legacy",
      timer_command_id: null,
    });

    const commands = await withClient(scratch, async (client) => {
      const { rows } = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM timer_commands`
      );
      return Number(rows[0].count);
    });
    expect(commands).toBe(0);
  });
});

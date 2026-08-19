import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/migrate";
import { urlForDatabase, withClient } from "../helpers/db";

/**
 * Phase 4 ticket #98: Teams are snapshotted into migration evidence and
 * dropped. They are not converted into Project Assignments. HTTP is not this
 * suite — the journal is the seam. Characterization of the gone contract lives
 * in tests/characterization/teams.test.ts.
 */

const SCRATCH_DB = "docuflow_drop_teams";
const BEFORE_DROP = "0010_workspace_rls";
const DROPPED = ["teams", "team_members", "team_invites"] as const;
const ASSIGNMENT_ID = "pm-keep";

async function publicTables(url: string): Promise<string[]> {
  return withClient(url, async (client) => {
    const { rows } = await client.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables
        WHERE schemaname = 'public'
          AND tablename NOT LIKE '\\_\\_drizzle%'
        ORDER BY tablename`
    );
    return rows.map((row) => row.tablename);
  });
}

describe("drop Teams", () => {
  let scratch: string;

  beforeAll(async () => {
    await withClient(urlForDatabase("postgres"), async (client) => {
      await client.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB}`);
      await client.query(`CREATE DATABASE ${SCRATCH_DB}`);
    });
    scratch = urlForDatabase(SCRATCH_DB);

    await migrate(scratch, { applyThrough: BEFORE_DROP });
    await withClient(scratch, async (client) => {
      await client.query(
        `INSERT INTO users (id, email, password, role, is_main_admin, created_at)
         VALUES ('u-keep', 'keep@example.test', 'x', 'user', 0, '2020-01-01')`
      );
      await client.query(
        `INSERT INTO projects (id, name, owner_id, workspace_id)
         VALUES ('p-keep', 'Keep', 'u-keep', 'seeded')`
      );
      await client.query(
        `INSERT INTO crm_projects (id, project_id, status, workspace_id)
         VALUES ('crm-keep', 'p-keep', 'lead', 'seeded')`
      );
      await client.query(
        `INSERT INTO project_members (id, crm_project_id, user_id, workspace_id)
         VALUES ($1, 'crm-keep', 'u-keep', 'seeded')`,
        [ASSIGNMENT_ID]
      );
    });
    await migrate(scratch);
  }, 120_000);

  afterAll(async () => {
    await withClient(urlForDatabase("postgres"), (client) =>
      client.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB}`)
    );
  });

  it("drops teams, team_members, and team_invites through the journal", async () => {
    const tables = await publicTables(scratch);
    for (const table of DROPPED) {
      expect(tables, `${table} must be gone`).not.toContain(table);
    }
  });

  it("leaves existing Project Assignments (project_members) in place", async () => {
    const tables = await publicTables(scratch);
    expect(tables).toContain("project_members");
    const remaining = await withClient(scratch, (client) =>
      client.query<{ id: string }>(`SELECT id FROM project_members ORDER BY id`)
    );
    expect(remaining.rows.map((row) => row.id)).toEqual([ASSIGNMENT_ID]);
  });
});

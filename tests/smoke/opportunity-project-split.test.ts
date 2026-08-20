import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/migrate";
import { urlForDatabase, withClient } from "../helpers/db";

/**
 * Phase 6 ticket #114: split Opportunity from Project (ADR-0001, Spec #112).
 * HTTP is not this suite — the journal is the seam. Characterization stays
 * green unless an HTTP contract actually changes.
 */

const SCRATCH_DB = "docuflow_opportunity_project_split";
const BEFORE_SPLIT = "0011_drop_teams";

const PIPELINE_STAGES = [
  "lead",
  "discovering_call_completed",
  "proposal_sent",
  "follow_up",
  "in_negotiation",
] as const;

const PROJECT_STATUSES = [
  "planned",
  "active",
  "on_hold",
  "in_review",
  "completed",
  "archived",
] as const;

const ASSIGNMENT_ID = "pm-keep";
const WORKSPACE_ROLE_SLUGS = ["owner", "administrator", "member"] as const;

const IDS = {
  lead: "crm-lead",
  won: "crm-won",
  internal: "crm-internal",
  docsOnly: "crm-docs",
  documented: "crm-documented",
} as const;

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

describe("split Opportunity from Project", () => {
  let scratch: string;

  beforeAll(async () => {
    await withClient(urlForDatabase("postgres"), async (client) => {
      await client.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB}`);
      await client.query(`CREATE DATABASE ${SCRATCH_DB}`);
    });
    scratch = urlForDatabase(SCRATCH_DB);

    await migrate(scratch, { applyThrough: BEFORE_SPLIT });
    await withClient(scratch, async (client) => {
      await client.query(
        `INSERT INTO users (id, email, password, role, is_main_admin, created_at)
         VALUES ('u-keep', 'keep@example.test', 'x', 'user', 0, '2020-01-01')`
      );
      await client.query(
        `INSERT INTO crm_clients (id, name, owner_id, workspace_id)
         VALUES ('client-keep', 'Northwind', 'u-keep', 'seeded')`
      );
      await client.query(
        `INSERT INTO projects (id, name, owner_id, workspace_id) VALUES
           ('p-lead', 'Lead work', 'u-keep', 'seeded'),
           ('p-won', 'Won work', 'u-keep', 'seeded'),
           ('p-internal', 'Internal work', 'u-keep', 'seeded'),
           ('p-docs', 'Docs only', 'u-keep', 'seeded'),
           ('p-documented', 'Legacy handbook', 'u-keep', 'seeded')`
      );
      await client.query(
        `INSERT INTO crm_projects (id, project_id, client_id, status, project_type, is_documentation_only, workspace_id) VALUES
           ('${IDS.lead}', 'p-lead', 'client-keep', 'lead', 'one_time', 0, 'seeded'),
           ('${IDS.won}', 'p-won', 'client-keep', 'won_in_progress', 'monthly', 0, 'seeded'),
           ('${IDS.internal}', 'p-internal', NULL, 'lead', 'internal', 0, 'seeded'),
           ('${IDS.docsOnly}', 'p-docs', NULL, 'lead', 'one_time', 1, 'seeded'),
           ('${IDS.documented}', 'p-documented', NULL, 'documented', 'one_time', 0, 'seeded')`
      );
      await client.query(
        `INSERT INTO project_members (id, crm_project_id, user_id, workspace_id)
         VALUES ($1, '${IDS.won}', 'u-keep', 'seeded')`,
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

  it("adds Opportunity as its own record beside Project", async () => {
    const tables = await publicTables(scratch);
    expect(tables).toContain("opportunities");
    expect(tables).toContain("crm_projects");

    const columns = await withClient(scratch, async (client) => {
      const { rows } = await client.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'crm_projects'
          ORDER BY column_name`
      );
      return rows.map((row) => row.column_name);
    });
    expect(columns).toContain("project_status");
    expect(columns).toContain("status");
  });

  it("does not store pipeline stage as Project Status", async () => {
    const rows = await withClient(scratch, async (client) => {
      const { rows } = await client.query<{ id: string; status: string; project_status: string }>(
        `SELECT id, status, project_status FROM crm_projects ORDER BY id`
      );
      return rows;
    });

    for (const row of rows) {
      expect(PROJECT_STATUSES, `${row.id} project_status`).toContain(row.project_status);
      expect(PIPELINE_STAGES, `${row.id} project_status must not be a pipeline stage`).not.toContain(
        row.project_status
      );
    }

    expect(rows.find((row) => row.id === IDS.lead)?.project_status).toBe("planned");
    expect(rows.find((row) => row.id === IDS.won)?.project_status).toBe("active");
  });

  it("links a won Opportunity to a Client Project and leaves Project ids unchanged", async () => {
    const opportunities = await withClient(scratch, async (client) => {
      const { rows } = await client.query<{
        id: string;
        crm_project_id: string | null;
        stage: string;
        client_id: string | null;
      }>(`SELECT id, crm_project_id, stage, client_id FROM opportunities ORDER BY crm_project_id`);
      return rows;
    });

    const projects = await withClient(scratch, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `SELECT id FROM crm_projects ORDER BY id`
      );
      return rows.map((row) => row.id);
    });
    expect(projects).toEqual(
      [IDS.docsOnly, IDS.documented, IDS.internal, IDS.lead, IDS.won].sort()
    );

    const won = opportunities.find((row) => row.crm_project_id === IDS.won);
    expect(won).toMatchObject({
      crm_project_id: IDS.won,
      stage: "won",
      client_id: "client-keep",
    });
    expect(won?.id).not.toBe(IDS.won);

    const lead = opportunities.find((row) => row.crm_project_id === IDS.lead);
    expect(lead).toMatchObject({
      crm_project_id: IDS.lead,
      stage: "lead",
      client_id: "client-keep",
    });
  });

  it("lets a won Opportunity link a Client Project created after the split", async () => {
    await withClient(scratch, async (client) => {
      await client.query(
        `INSERT INTO opportunities (id, stage, client_id, workspace_id)
         VALUES ('opp-unlinked', 'won', 'client-keep', 'seeded')`
      );
      await client.query(
        `INSERT INTO projects (id, name, owner_id, workspace_id)
         VALUES ('p-from-opp', 'From won Opportunity', 'u-keep', 'seeded')`
      );
      await client.query(
        `INSERT INTO crm_projects (id, project_id, client_id, status, project_status, workspace_id)
         VALUES ('crm-from-opp', 'p-from-opp', 'client-keep', 'won', 'planned', 'seeded')`
      );
      await client.query(
        `UPDATE opportunities SET crm_project_id = 'crm-from-opp' WHERE id = 'opp-unlinked'`
      );
    });

    const linked = await withClient(scratch, async (client) => {
      const { rows } = await client.query<{
        id: string;
        crm_project_id: string;
        stage: string;
        client_id: string;
      }>(`SELECT id, crm_project_id, stage, client_id FROM opportunities WHERE id = 'opp-unlinked'`);
      return rows[0];
    });
    expect(linked).toEqual({
      id: "opp-unlinked",
      crm_project_id: "crm-from-opp",
      stage: "won",
      client_id: "client-keep",
    });
  });

  it("gives Internal Projects and documented-only Projects no Opportunity", async () => {
    const linked = await withClient(scratch, async (client) => {
      const { rows } = await client.query<{ crm_project_id: string }>(
        `SELECT crm_project_id FROM opportunities WHERE crm_project_id = ANY($1)`,
        [[IDS.internal, IDS.docsOnly, IDS.documented]]
      );
      return rows.map((row) => row.crm_project_id);
    });
    expect(linked).toEqual([]);
  });

  it("keeps Project Assignment as the visibility grant and leaves Workspace Role alone", async () => {
    const assignment = await withClient(scratch, async (client) => {
      const { rows } = await client.query<{ id: string; crm_project_id: string }>(
        `SELECT id, crm_project_id FROM project_members ORDER BY id`
      );
      return rows;
    });
    expect(assignment).toEqual([{ id: ASSIGNMENT_ID, crm_project_id: IDS.won }]);

    const roles = await withClient(scratch, async (client) => {
      const { rows } = await client.query<{ slug: string }>(
        `SELECT slug FROM workspace_roles WHERE workspace_id = 'seeded' ORDER BY slug`
      );
      return rows.map((row) => row.slug);
    });
    expect(roles).toEqual([...WORKSPACE_ROLE_SLUGS].sort());
  });
});

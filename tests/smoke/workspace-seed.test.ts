import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/migrate";
import { urlForDatabase, withClient } from "../helpers/db";

/**
 * Phase 4 ticket #93: the journal seeds one Workspace and maps today's users
 * onto Memberships. HTTP still authenticates as before — this suite never
 * boots the app. It builds a throwaway database, plants the legacy rows the
 * seed reads, and asks the journal what it left behind.
 *
 * `applyThrough` stops the runner just before the seed so the fixture users
 * exist when the mapping SQL runs. Production already has users; the harness
 * does not.
 */

/** Last journal entry that must not seed a Workspace. */
const BEFORE_SEED = "0006_square_wild_child";

const SCRATCH_DB = "docuflow_workspace_seed";

const TRACKING_POLICY = {
  screenshotsEnabled: true,
  captureIntervalMinMin: 3,
  captureIntervalMaxMin: 5,
  activeHoursEnabled: false,
  activeHoursStart: "08:00",
  activeHoursEnd: "18:00",
  idlePromptEnabled: true,
  idleTimeoutMinutes: 10,
  idleCountdownSeconds: 60,
};

const ALLOWED_TIMEZONES = ["Europe/Paris", "UTC"];

interface MembershipRow {
  email: string;
  role_slug: string;
  archived: boolean;
  has_view_daily_updates: boolean;
}

async function membershipsOf(url: string): Promise<MembershipRow[]> {
  return withClient(url, async (client) => {
    const { rows } = await client.query<MembershipRow>(
      `SELECT u.email,
              wr.slug AS role_slug,
              (m.archived_at IS NOT NULL) AS archived,
              (
                EXISTS (
                  SELECT 1
                    FROM workspace_role_capabilities wrc
                   WHERE wrc.workspace_role_id = m.workspace_role_id
                     AND wrc.capability_id = 'view_daily_updates'
                ) OR EXISTS (
                  SELECT 1
                    FROM membership_capabilities mc
                   WHERE mc.membership_id = m.id
                     AND mc.capability_id = 'view_daily_updates'
                )
              ) AS has_view_daily_updates
         FROM memberships m
         JOIN users u ON u.id = m.user_id
         JOIN workspace_roles wr ON wr.id = m.workspace_role_id
        ORDER BY u.email`
    );
    return rows;
  });
}

describe("workspace seed", () => {
  let scratch: string;

  beforeAll(async () => {
    await withClient(urlForDatabase("postgres"), async (client) => {
      await client.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB}`);
      await client.query(`CREATE DATABASE ${SCRATCH_DB}`);
    });
    scratch = urlForDatabase(SCRATCH_DB);

    await migrate(scratch, { applyThrough: BEFORE_SEED });

    await withClient(scratch, async (client) => {
      await client.query(
        `INSERT INTO users (id, email, password, role, is_main_admin, can_view_daily_updates, is_archived, created_at)
         VALUES
           ('u-owner', 'owner@example.test', 'x', 'admin', 1, 0, false, '2020-01-01'),
           ('u-second-main', 'second-main@example.test', 'x', 'admin', 1, 0, false, '2020-06-01'),
           ('u-admin', 'admin@example.test', 'x', 'admin', 0, 0, false, '2020-02-01'),
           ('u-member', 'member@example.test', 'x', 'user', 0, 0, false, '2020-03-01'),
           ('u-flagged', 'flagged@example.test', 'x', 'user', 0, 1, false, '2020-04-01'),
           ('u-archived', 'archived@example.test', 'x', 'user', 0, 0, true, '2020-05-01')`
      );
      await client.query(
        `INSERT INTO org_settings (id, screenshot_policy, allowed_timezones)
         VALUES ('default', $1::jsonb, $2::jsonb)`,
        [JSON.stringify(TRACKING_POLICY), JSON.stringify(ALLOWED_TIMEZONES)]
      );
    });

    await migrate(scratch);
  }, 120_000);

  afterAll(async () => {
    await withClient(urlForDatabase("postgres"), (client) =>
      client.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB}`)
    );
  });

  it("seeds one named Workspace with Tracking Policy copied from org_settings", async () => {
    const workspaces = await withClient(scratch, (client) =>
      client.query<{
        id: string;
        screenshot_policy: typeof TRACKING_POLICY;
        allowed_timezones: string[];
      }>(`SELECT id, screenshot_policy, allowed_timezones FROM workspaces`)
    );

    expect(workspaces.rows).toEqual([
      {
        id: "seeded",
        screenshot_policy: TRACKING_POLICY,
        allowed_timezones: ALLOWED_TIMEZONES,
      },
    ]);

    const leftover = await withClient(scratch, (client) =>
      client.query(`SELECT id FROM org_settings`)
    );
    expect(leftover.rows).toEqual([{ id: "default" }]);
  });

  it("maps the earliest is_main_admin user to Owner, other admins to Administrator, users to Member, and archived users to an Archived Membership", async () => {
    expect(await membershipsOf(scratch)).toEqual([
      {
        email: "admin@example.test",
        role_slug: "administrator",
        archived: false,
        has_view_daily_updates: true,
      },
      {
        email: "archived@example.test",
        role_slug: "member",
        archived: true,
        has_view_daily_updates: false,
      },
      {
        email: "flagged@example.test",
        role_slug: "member",
        archived: false,
        has_view_daily_updates: true,
      },
      {
        email: "member@example.test",
        role_slug: "member",
        archived: false,
        has_view_daily_updates: false,
      },
      {
        email: "owner@example.test",
        role_slug: "owner",
        archived: false,
        has_view_daily_updates: true,
      },
      {
        email: "second-main@example.test",
        role_slug: "administrator",
        archived: false,
        has_view_daily_updates: true,
      },
    ]);
  });

  it("does not put workspace_id on users", async () => {
    const columns = await withClient(scratch, (client) =>
      client.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'users'
          ORDER BY column_name`
      )
    );
    expect(columns.rows.map((row) => row.column_name)).not.toContain("workspace_id");
  });

  it("leaves one Workspace and one Owner after a second migrate", async () => {
    expect(await migrate(scratch)).toEqual([]);

    const counts = await withClient(scratch, (client) =>
      client.query<{ workspaces: string; owners: string }>(
        `SELECT
           (SELECT count(*)::text FROM workspaces) AS workspaces,
           (SELECT count(*)::text
              FROM memberships m
              JOIN workspace_roles wr ON wr.id = m.workspace_role_id
             WHERE wr.slug = 'owner') AS owners`
      )
    );
    expect(counts.rows[0]).toEqual({ workspaces: "1", owners: "1" });
  });
});

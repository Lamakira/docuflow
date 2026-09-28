import { beforeAll, describe, expect, it, vi } from "vitest";
import pg from "pg";
import { resolveTestDatabaseUrl } from "../test-db-url";
import { withClient } from "../helpers/db";

/**
 * #297: row-level security only backs up query scoping when the runtime role is
 * subject to it. The role `DATABASE_URL` connects as is checked; production
 * refuses a role that bypasses RLS, development and test warn. The test
 * database is reached as its owner, which is exactly the bypass case.
 */

const APP_ROLE = "docuflow_app";
const APP_PASSWORD = "rls-harness";

function urlAsAppRole(): string {
  const url = new URL(resolveTestDatabaseUrl());
  url.username = APP_ROLE;
  url.password = APP_PASSWORD;
  return url.toString();
}

describe("runtime database role check", () => {
  beforeAll(async () => {
    await withClient(resolveTestDatabaseUrl(), (client) =>
      client.query(`ALTER ROLE ${APP_ROLE} WITH PASSWORD '${APP_PASSWORD}'`)
    );
  });

  it("refuses to boot in production on a role that bypasses RLS", async () => {
    const { pool } = await import("../../server/db");
    const { RlsBypassRoleError, assertRuntimeRoleEnforcesRls } = await import(
      "../../server/databaseRole"
    );

    const refused = assertRuntimeRoleEnforcesRls({ pool, production: true });
    await expect(refused).rejects.toBeInstanceOf(RlsBypassRoleError);
    await expect(refused).rejects.toThrow(/SUPERUSER/);
  });

  it("only warns outside production, so development and test still start", async () => {
    const { pool } = await import("../../server/db");
    const { assertRuntimeRoleEnforcesRls } = await import("../../server/databaseRole");
    const warn = vi.fn();

    const role = await assertRuntimeRoleEnforcesRls({ pool, production: false, warn });

    expect(role.superuser).toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/bypasses row-level security/));
  });

  it("boots in production as docuflow_app, which RLS applies to", async () => {
    const { assertRuntimeRoleEnforcesRls } = await import("../../server/databaseRole");
    const pool = new pg.Pool({ connectionString: urlAsAppRole() });
    const warn = vi.fn();
    try {
      await expect(assertRuntimeRoleEnforcesRls({ pool, production: true, warn })).resolves.toEqual({
        name: APP_ROLE,
        superuser: false,
        bypassRls: false,
        rowSecurityActive: true,
      });
      expect(warn).not.toHaveBeenCalled();
    } finally {
      await pool.end();
    }
  });

  it("refuses a table owner that is neither SUPERUSER nor BYPASSRLS", async () => {
    const { RlsBypassRoleError, assertRuntimeRoleEnforcesRls } = await import(
      "../../server/databaseRole"
    );
    const owner = {
      query: async () => ({
        rows: [{ name: "neondb_owner", superuser: false, bypass_rls: false, row_security_active: false }],
        rowCount: 1,
      }),
    };

    const refused = assertRuntimeRoleEnforcesRls({ pool: owner, production: true });
    await expect(refused).rejects.toBeInstanceOf(RlsBypassRoleError);
    await expect(refused).rejects.toThrow(/owns the Workspace-owned tables/);
  });
});

/**
 * The pool connects on first use, so boot may run before the database answers
 * (the image's boot smoke step has none at all). Production then checks on the
 * first query, and nothing reaches the database until the check passes.
 */
describe("runtime role gate on first use", () => {
  beforeAll(async () => {
    await withClient(resolveTestDatabaseUrl(), (client) =>
      client.query(`ALTER ROLE ${APP_ROLE} WITH PASSWORD '${APP_PASSWORD}'`)
    );
  });

  it("fails every query and checkout in production on a role that bypasses RLS", async () => {
    const { RlsBypassRoleError, gateOnRuntimeRole } = await import("../../server/databaseRole");
    const pool = new pg.Pool({ connectionString: resolveTestDatabaseUrl() });
    try {
      gateOnRuntimeRole(pool, { production: true });
      await expect(pool.query("SELECT 1")).rejects.toBeInstanceOf(RlsBypassRoleError);
      await expect(pool.connect()).rejects.toBeInstanceOf(RlsBypassRoleError);
    } finally {
      await pool.end();
    }
  });

  it("lets queries and checkouts through in production as docuflow_app", async () => {
    const { gateOnRuntimeRole } = await import("../../server/databaseRole");
    const pool = new pg.Pool({ connectionString: urlAsAppRole() });
    try {
      gateOnRuntimeRole(pool, { production: true });
      await expect(pool.query("SELECT 1 AS one")).resolves.toMatchObject({ rows: [{ one: 1 }] });
      const client = await pool.connect();
      client.release();
    } finally {
      await pool.end();
    }
  });

  it("boots without a database, then checks again on the next use", async () => {
    const { checkRuntimeRoleAtBoot, gateOnRuntimeRole } = await import("../../server/databaseRole");
    const ran: string[] = [];
    let reachable = false;
    const query = async (text: string) => {
      if (!reachable) throw new Error("connect ECONNREFUSED 127.0.0.1:5432");
      ran.push(text);
      return {
        rows: [{ name: APP_ROLE, superuser: false, bypass_rls: false, row_security_active: true }],
        rowCount: 1,
      };
    };
    const pool = {
      query,
      connect: async () => {
        if (!reachable) throw new Error("connect ECONNREFUSED 127.0.0.1:5432");
        return { query, release: () => {} };
      },
    };
    const warn = vi.fn();

    const verify = gateOnRuntimeRole(pool, { production: true });
    await expect(checkRuntimeRoleAtBoot(verify, warn)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/not checked at boot.*ECONNREFUSED/));
    await expect(pool.query("SELECT 1")).rejects.toThrow(/ECONNREFUSED/);

    reachable = true;
    await pool.query("SELECT 1");
    await pool.query("SELECT 2");
    expect(ran.filter((text) => text.includes("pg_roles"))).toHaveLength(1);
    expect(ran.filter((text) => !text.includes("pg_roles"))).toEqual(["SELECT 1", "SELECT 2"]);
  });

  it("still refuses to boot when the database answers with a bypass role", async () => {
    const { RlsBypassRoleError, checkRuntimeRoleAtBoot, gateOnRuntimeRole } = await import(
      "../../server/databaseRole"
    );
    const pool = new pg.Pool({ connectionString: resolveTestDatabaseUrl() });
    try {
      const verify = gateOnRuntimeRole(pool, { production: true });
      await expect(checkRuntimeRoleAtBoot(verify, vi.fn())).rejects.toBeInstanceOf(RlsBypassRoleError);
    } finally {
      await pool.end();
    }
  });
});

import { describe, expect, it, vi } from "vitest";
import pg from "pg";
import { TEST_APP_ROLE, resolveTestAppDatabaseUrl, resolveTestDatabaseUrl } from "../test-db-url";

/**
 * #297: row-level security only backs up query scoping when the runtime role is
 * subject to it. The role the server connects as is checked; production and
 * test refuse a role that bypasses RLS, and so does development unless
 * DOCUFLOW_ALLOW_OWNER_DB=1 (#323), which only warns. The harness runs the
 * server as docuflow_app (`global-setup.ts` sets its password), so the bypass
 * case is the test database reached as its owner.
 */

const APP_ROLE = TEST_APP_ROLE;

function urlAsAppRole(): string {
  return resolveTestAppDatabaseUrl();
}

function ownerPool(): pg.Pool {
  return new pg.Pool({ connectionString: resolveTestDatabaseUrl() });
}

describe("runtime database role check", () => {
  it("refuses to boot on a role that bypasses RLS", async () => {
    const pool = ownerPool();
    const { RlsBypassRoleError, assertRuntimeRoleEnforcesRls } = await import(
      "../../server/databaseRole"
    );
    try {
      const refused = assertRuntimeRoleEnforcesRls({ pool, refuse: true });
      await expect(refused).rejects.toBeInstanceOf(RlsBypassRoleError);
      await expect(refused).rejects.toThrow(/SUPERUSER/);
    } finally {
      await pool.end();
    }
  });

  it("tells a developer what to do locally, and production what to point at", async () => {
    const { RlsBypassRoleError } = await import("../../server/databaseRole");
    const role = { name: "postgres", superuser: true, bypassRls: true, rowSecurityActive: false };

    const local = new RlsBypassRoleError(role, { development: true }).message;
    expect(local).toContain("DATABASE_APP_URL=postgresql://docuflow_app:docuflow_app_dev@localhost:5434/docuflow_dev");
    expect(local).toContain("npm run db:app-role");
    expect(local).toContain("DOCUFLOW_ALLOW_OWNER_DB=1");

    const production = new RlsBypassRoleError(role).message;
    expect(production).toContain("Point DATABASE_APP_URL (or DATABASE_URL) at docuflow_app");
    expect(production).not.toContain("db:app-role");
  });

  it("only warns when refusing is off (development with DOCUFLOW_ALLOW_OWNER_DB=1)", async () => {
    const pool = ownerPool();
    const { assertRuntimeRoleEnforcesRls } = await import("../../server/databaseRole");
    const warn = vi.fn();
    try {
      const role = await assertRuntimeRoleEnforcesRls({ pool, refuse: false, warn });

      expect(role.superuser).toBe(true);
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/bypasses row-level security/));
    } finally {
      await pool.end();
    }
  });

  it("runs the server under test as docuflow_app", async () => {
    const { verifyRuntimeRole } = await import("../../server/db");
    await expect(verifyRuntimeRole()).resolves.toMatchObject({ name: APP_ROLE, rowSecurityActive: true });
  });

  it("boots where it refuses as docuflow_app, which RLS applies to", async () => {
    const { assertRuntimeRoleEnforcesRls } = await import("../../server/databaseRole");
    const pool = new pg.Pool({ connectionString: urlAsAppRole() });
    const warn = vi.fn();
    try {
      await expect(assertRuntimeRoleEnforcesRls({ pool, refuse: true, warn })).resolves.toEqual({
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

    const refused = assertRuntimeRoleEnforcesRls({ pool: owner, refuse: true });
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
  it("fails every query and checkout where it refuses on a role that bypasses RLS", async () => {
    const { RlsBypassRoleError, gateOnRuntimeRole } = await import("../../server/databaseRole");
    const pool = new pg.Pool({ connectionString: resolveTestDatabaseUrl() });
    try {
      gateOnRuntimeRole(pool, { refuse: true });
      await expect(pool.query("SELECT 1")).rejects.toBeInstanceOf(RlsBypassRoleError);
      await expect(pool.connect()).rejects.toBeInstanceOf(RlsBypassRoleError);
    } finally {
      await pool.end();
    }
  });

  it("lets queries and checkouts through where it refuses as docuflow_app", async () => {
    const { gateOnRuntimeRole } = await import("../../server/databaseRole");
    const pool = new pg.Pool({ connectionString: urlAsAppRole() });
    try {
      gateOnRuntimeRole(pool, { refuse: true });
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

    const verify = gateOnRuntimeRole(pool, { refuse: true });
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
      const verify = gateOnRuntimeRole(pool, { refuse: true });
      await expect(checkRuntimeRoleAtBoot(verify, vi.fn())).rejects.toBeInstanceOf(RlsBypassRoleError);
    } finally {
      await pool.end();
    }
  });
});

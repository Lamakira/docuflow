import { beforeAll, describe, expect, it, vi } from "vitest";
import pg from "pg";
import { resolveTestDatabaseUrl } from "../test-db-url";
import { withClient } from "../helpers/db";

/**
 * #297: row-level security only backs up query scoping when the runtime role is
 * subject to it. Boot checks the role `DATABASE_URL` connects as; production
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

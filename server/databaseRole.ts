/**
 * Row-level security backs up query scoping (ADR-0006, #97) only while the
 * runtime role is subject to it. A superuser, a BYPASSRLS role, or the owner of
 * the Workspace-owned tables turns every policy off without an error, so the
 * role `DATABASE_URL` connects as is checked at boot (#297).
 *
 * Production refuses to start. Development and test connect as the database
 * owner on purpose, so there the same finding is a warning.
 */

import type { DbPool } from "./db";

export interface RuntimeRole {
  name: string;
  superuser: boolean;
  bypassRls: boolean;
  /** Whether RLS applies to this role on a Workspace-owned table; false for a table owner. */
  rowSecurityActive: boolean;
}

export class RlsBypassRoleError extends Error {
  constructor(readonly role: RuntimeRole) {
    const reasons = [
      role.superuser && "SUPERUSER",
      role.bypassRls && "BYPASSRLS",
      !role.superuser && !role.bypassRls && !role.rowSecurityActive && "owns the Workspace-owned tables",
    ].filter(Boolean);
    super(
      `Database role "${role.name}" bypasses row-level security (${reasons.join(", ")}). ` +
        `Point DATABASE_URL at docuflow_app and keep the owner in DATABASE_MIGRATE_URL.`
    );
    this.name = "RlsBypassRoleError";
  }
}

export async function readRuntimeRole(pool: Pick<DbPool, "query">): Promise<RuntimeRole> {
  const { rows } = await pool.query(
    `SELECT r.rolname AS name,
            r.rolsuper AS superuser,
            r.rolbypassrls AS bypass_rls,
            coalesce(row_security_active(to_regclass('public.projects')), false) AS row_security_active
       FROM pg_roles r
      WHERE r.rolname = current_user`
  );
  const [row] = rows;
  return {
    name: row.name,
    superuser: row.superuser,
    bypassRls: row.bypass_rls,
    rowSecurityActive: row.row_security_active,
  };
}

export async function assertRuntimeRoleEnforcesRls(options: {
  pool: Pick<DbPool, "query">;
  production: boolean;
  warn?: (message: string) => void;
}): Promise<RuntimeRole> {
  const role = await readRuntimeRole(options.pool);
  if (!role.superuser && !role.bypassRls && role.rowSecurityActive) return role;
  const bypass = new RlsBypassRoleError(role);
  if (options.production) throw bypass;
  (options.warn ?? console.warn)(bypass.message);
  return role;
}

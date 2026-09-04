#!/usr/bin/env tsx
/**
 * create-admin.ts — Create an admin user directly in the database.
 *
 * Usage:
 *   npx tsx scripts/create-admin.ts <email> <firstName> <lastName>
 *
 * Example:
 *   DATABASE_URL="postgres://..." npx tsx scripts/create-admin.ts admin@example.com Alice Smith
 *
 * The script uses DATABASE_URL (or PG* vars as fallback) and inserts a user with
 * role='admin' and isMainAdmin=1. Credentials live at the IdentityProvider
 * (#161); this script does not write a password.
 *
 * Plain node-postgres, like every other script here: nothing an operational
 * command does needs the Neon serverless driver (ADR-0016).
 */

import pg from "pg";
import { maskDatabaseUrl, requireDatabaseUrl } from "../shared/databaseUrl";

async function main() {
  const [, , email, firstName, lastName] = process.argv;

  if (!email || !firstName || !lastName) {
    console.error("Usage: npx tsx scripts/create-admin.ts <email> <firstName> <lastName>");
    process.exit(1);
  }

  const connStr = requireDatabaseUrl();
  console.log(`[DB] Connecting to: ${maskDatabaseUrl(connStr)}`);

  const pool = new pg.Pool({ connectionString: connStr });

  try {
    const existing = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
    if (existing.rows.length > 0) {
      console.error(`Error: a user with email "${email}" already exists (id=${existing.rows[0].id}).`);
      process.exit(1);
    }

    const result = await pool.query(
      `INSERT INTO users (email, first_name, last_name, role, is_main_admin)
       VALUES ($1, $2, $3, 'admin', 1)
       RETURNING id, email, first_name, last_name, role, is_main_admin`,
      [email, firstName, lastName]
    );

    const user = result.rows[0];
    console.log("\nAdmin user created:");
    console.log(`  id:          ${user.id}`);
    console.log(`  email:       ${user.email}`);
    console.log(`  first_name:  ${user.first_name}`);
    console.log(`  last_name:   ${user.last_name}`);
    console.log(`  role:        ${user.role}`);
    console.log(`  is_main_admin: ${user.is_main_admin}`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Failed:", err.message ?? err);
  process.exit(1);
});

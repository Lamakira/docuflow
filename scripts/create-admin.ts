#!/usr/bin/env tsx
/**
 * create-admin.ts — Create an admin user directly in the database.
 *
 * Usage:
 *   npx tsx scripts/create-admin.ts <email> <password> <firstName> <lastName>
 *
 * Example:
 *   DATABASE_URL="postgres://..." npx tsx scripts/create-admin.ts admin@example.com secret123 Alice Smith
 *
 * The script uses DATABASE_URL (or PG* vars as fallback), hashes the password
 * with bcrypt (12 rounds), and inserts a user with role='admin' and isMainAdmin=1.
 */

import bcrypt from "bcrypt";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";

const SALT_ROUNDS = 12;

function resolveConnectionString(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

  const host = process.env.PGHOST;
  const port = process.env.PGPORT ?? "5432";
  const user = process.env.PGUSER;
  const password = process.env.PGPASSWORD;
  const database = process.env.PGDATABASE;

  if (!host || !user || !password || !database) {
    throw new Error(
      "Database not configured. Set DATABASE_URL or all PG* variables (PGHOST, PGUSER, PGPASSWORD, PGDATABASE)."
    );
  }

  return `postgresql://${user}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
}

async function main() {
  const [, , email, password, firstName, lastName] = process.argv;

  if (!email || !password || !firstName || !lastName) {
    console.error("Usage: npx tsx scripts/create-admin.ts <email> <password> <firstName> <lastName>");
    process.exit(1);
  }

  const connStr = resolveConnectionString();
  const masked = connStr.replace(/:([^@]+)@/, ":<hidden>@");
  console.log(`[DB] Connecting to: ${masked}`);

  neonConfig.webSocketConstructor = ws;
  const pool = new Pool({ connectionString: connStr });

  try {
    // Check for duplicate
    const existing = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
    if (existing.rows.length > 0) {
      console.error(`Error: a user with email "${email}" already exists (id=${existing.rows[0].id}).`);
      process.exit(1);
    }

    const hashed = await bcrypt.hash(password, SALT_ROUNDS);

    const result = await pool.query(
      `INSERT INTO users (email, password, first_name, last_name, role, is_main_admin)
       VALUES ($1, $2, $3, $4, 'admin', 1)
       RETURNING id, email, first_name, last_name, role, is_main_admin`,
      [email, hashed, firstName, lastName]
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

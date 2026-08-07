/**
 * db-env-check.ts — npm run db:env:check
 *
 * Displays which DB connection mode is active and which variables are
 * present or missing. Never prints passwords or full connection strings.
 *
 * A diagnostic, so it resolves without throwing: the point is to report every
 * variable that is absent, not to stop at the first one.
 */

import {
  maskDatabaseUrl,
  PG_VARS,
  REQUIRED_PG_VARS,
  resolveDatabaseUrl,
  DEFAULT_PG_PORT,
} from "../shared/databaseUrl";

function maskValue(key: string, value: string | undefined): string {
  if (!value) return "(not set)";
  if (key === "PGPASSWORD") return "***";
  return value;
}

console.log("\n=== DocuFlow — DB Environment Check ===\n");

const { url, source, missing } = resolveDatabaseUrl();

if (source === "DATABASE_URL") {
  console.log("✅  Mode: DATABASE_URL (priority)");
  console.log(`    Value: ${maskDatabaseUrl(url!)}`);
} else {
  console.log("⚠️   DATABASE_URL: not set — checking PG* fallback...\n");

  for (const key of PG_VARS) {
    const value = process.env[key];
    const required = (REQUIRED_PG_VARS as readonly string[]).includes(key);
    const icon = value ? "✅" : required ? "❌" : "⚠️ ";
    const label = required ? "" : ` (optional, default: ${DEFAULT_PG_PORT})`;
    console.log(`  ${icon}  ${key}: ${maskValue(key, value)}${label}`);
  }

  console.log();
  if (url) {
    console.log("✅  Mode: PG* variables — all required vars present");
    console.log(`    Effective URL: ${maskDatabaseUrl(url)}`);
  } else {
    console.log("❌  Mode: INCOMPLETE — missing required variables:");
    for (const key of missing) console.log(`    - ${key}`);
    console.log("\n    Fix: set DATABASE_URL or all required PG* variables.");
    process.exitCode = 1;
  }
}

console.log("\n=== Check complete ===\n");

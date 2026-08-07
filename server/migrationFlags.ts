/**
 * migrationFlags.ts
 *
 * Detects which optional schema migrations have been applied in the current DB.
 * Guards are checked at startup and cached — no per-request overhead.
 *
 * Add a new flag here whenever a migration may not have been applied yet on
 * all environments (prod / staging / dev).
 */

import { db } from "./db";
import { sql } from "drizzle-orm";

interface MigrationFlags {
  /** true when the `tasks` table and `time_entries.task_id` column exist */
  tasksEnabled: boolean;
}

const flags: MigrationFlags = {
  tasksEnabled: false,
};

/**
 * Probe the DB and populate flags.
 * Call once at app startup — never throws; defaults to disabled on any error.
 */
export async function detectMigrationFlags(): Promise<void> {
  try {
    // Check tasks table
    await db.execute(sql`SELECT 1 FROM tasks LIMIT 0`);
    // Check task_id column on time_entries
    await db.execute(sql`SELECT task_id FROM time_entries LIMIT 0`);
    flags.tasksEnabled = true;
    console.log("[MigrationFlags] tasks: ENABLED");
  } catch {
    flags.tasksEnabled = false;
    console.log("[MigrationFlags] tasks: DISABLED (migration 002 not applied)");
  }
}

export function isTasksEnabled(): boolean {
  return flags.tasksEnabled;
}

import { createApp, log } from "./app";
import { serveStatic } from "./static";
import { storage } from "./storage";
import { detectMigrationFlags, setTasksEnabled } from "./migrationFlags";
import { pool } from "./db";

/**
 * Ensure Migration 002 (tasks) is applied (idempotent).
 * Safe to run every boot — uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS.
 */
async function ensureTasksMigration(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tasks (
      id             VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      crm_project_id VARCHAR NOT NULL REFERENCES crm_projects(id) ON DELETE CASCADE,
      name           VARCHAR(255) NOT NULL,
      description    TEXT,
      status         VARCHAR(20) NOT NULL DEFAULT 'open',
      created_at     TIMESTAMP DEFAULT NOW(),
      updated_at     TIMESTAMP DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_crm_project ON tasks(crm_project_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_status      ON tasks(status);
    ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS task_id VARCHAR REFERENCES tasks(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_time_entries_task_id ON time_entries(task_id);
  `);
}

/**
 * Ensure the Desktop Agent tables exist (idempotent — safe to run every boot).
 * This covers databases provisioned before the agent schema was added.
 */
async function ensureAgentTables(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "devices" (
      "id"                varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "user_id"           varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "name"              varchar(255) NOT NULL,
      "os"                varchar(100),
      "client_version"    varchar(50),
      "device_token_hash" varchar(64) NOT NULL,
      "last_seen_at"      timestamp,
      "revoked_at"        timestamp,
      "created_at"        timestamp DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS "idx_devices_user"       ON "devices"("user_id");
    CREATE INDEX IF NOT EXISTS "idx_devices_token_hash" ON "devices"("device_token_hash");

    CREATE TABLE IF NOT EXISTS "agent_pairing_codes" (
      "id"         varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "user_id"    varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "code"       varchar(10) NOT NULL UNIQUE,
      "expires_at" timestamp NOT NULL,
      "used_at"    timestamp,
      "created_at" timestamp DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS "idx_pairing_code" ON "agent_pairing_codes"("code");

    CREATE TABLE IF NOT EXISTS "agent_processed_batches" (
      "batch_id"     varchar PRIMARY KEY,
      "device_id"    varchar NOT NULL REFERENCES "devices"("id") ON DELETE CASCADE,
      "event_count"  integer NOT NULL DEFAULT 0,
      "processed_at" timestamp DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS "idx_processed_batches_device" ON "agent_processed_batches"("device_id");
    CREATE INDEX IF NOT EXISTS "idx_processed_batches_time"   ON "agent_processed_batches"("processed_at");

    CREATE TABLE IF NOT EXISTS "agent_activity_events" (
      "id"            varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "device_id"     varchar NOT NULL REFERENCES "devices"("id") ON DELETE CASCADE,
      "user_id"       varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "time_entry_id" varchar REFERENCES "time_entries"("id") ON DELETE SET NULL,
      "batch_id"      varchar NOT NULL,
      "event_type"    varchar(50) NOT NULL,
      "timestamp"     timestamp NOT NULL,
      "data"          jsonb,
      "created_at"    timestamp DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS "idx_agent_events_device"    ON "agent_activity_events"("device_id");
    CREATE INDEX IF NOT EXISTS "idx_agent_events_user_time" ON "agent_activity_events"("user_id", "timestamp");
    CREATE INDEX IF NOT EXISTS "idx_agent_events_batch"     ON "agent_activity_events"("batch_id");
  `);
}

(async () => {
  // Ensure tasks migration (002) is applied (idempotent).
  // On success we set the flag directly — detectMigrationFlags() is NOT called
  // afterward because it uses the Drizzle `db` connection which may target a
  // different DB (prod PG* vars vs dev DATABASE_URL) and would silently reset
  // tasksEnabled back to false, hiding the tasks feature.
  let tasksMigrationOk = false;
  try {
    await ensureTasksMigration();
    setTasksEnabled(true);
    tasksMigrationOk = true;
    log("Tasks migration OK");
  } catch (error) {
    console.error("Failed to ensure tasks migration:", error);
  }

  // Only run detectMigrationFlags as a fallback when ensureTasksMigration failed,
  // so it can still enable tasks if the table was applied manually (e.g., via psql).
  if (!tasksMigrationOk) {
    await detectMigrationFlags();
  }

  // Ensure Desktop Agent tables exist (idempotent)
  try {
    await ensureAgentTables();
    log("Agent tables OK");
  } catch (error) {
    console.error("Failed to ensure agent tables:", error);
  }

  const { app, httpServer } = await createApp();

  // Run migration to link any orphan projects to CRM on startup
  try {
    const { linkedCount } = await storage.linkOrphanProjectsToCrm();
    if (linkedCount > 0) {
      log(`Migrated ${linkedCount} orphan projects to CRM`);
    }
  } catch (error) {
    console.error("Failed to migrate orphan projects:", error);
  }

  // Seed default CRM modules and fields if not present
  try {
    await storage.seedDefaultCrmModules();
  } catch (error) {
    console.error("Failed to seed default CRM modules:", error);
  }

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();

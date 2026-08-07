-- ============================================================
-- Rollback 002: Remove tasks + task_id from time_entries
-- ============================================================
-- Apply with: psql $DATABASE_URL -f migrations/002_s2_tasks.down.sql
-- WARNING   : Destructive — drops all tasks data.
-- ============================================================

BEGIN;

-- 1. Drop index + column on time_entries first (depends on tasks FK)
DROP INDEX IF EXISTS idx_time_entries_task_id;
ALTER TABLE time_entries DROP COLUMN IF EXISTS task_id;

-- 2. Drop tasks table
DROP TABLE IF EXISTS tasks;

COMMIT;

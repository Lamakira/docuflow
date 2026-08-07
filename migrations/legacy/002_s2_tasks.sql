-- ============================================================
-- Migration 002: Sprint S2 — Tasks table + task_id on time_entries
-- ============================================================
-- Apply with: psql $DATABASE_URL -f migrations/002_s2_tasks.sql
-- Rollback  : psql $DATABASE_URL -f migrations/002_s2_tasks.down.sql
-- ============================================================

BEGIN;

-- 1. Create tasks table
CREATE TABLE IF NOT EXISTS tasks (
  id          VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  crm_project_id VARCHAR NOT NULL
    REFERENCES crm_projects(id) ON DELETE CASCADE,
  name        VARCHAR(255) NOT NULL,
  description TEXT,
  status      VARCHAR(20) NOT NULL DEFAULT 'open',
  created_at  TIMESTAMP DEFAULT NOW(),
  updated_at  TIMESTAMP DEFAULT NOW()
);

-- 2. Indexes
CREATE INDEX IF NOT EXISTS idx_tasks_crm_project ON tasks(crm_project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status      ON tasks(status);

-- 3. Add task_id column to time_entries (nullable — existing rows keep NULL)
ALTER TABLE time_entries
  ADD COLUMN IF NOT EXISTS task_id VARCHAR
    REFERENCES tasks(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_time_entries_task_id ON time_entries(task_id);

COMMIT;

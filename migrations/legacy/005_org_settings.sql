-- Migration 005: Org-wide settings table
-- Single-row table (id = 'default') for organisation-level configuration.
-- Currently stores screenshot capture policy pushed to desktop agents via heartbeat.

CREATE TABLE IF NOT EXISTS "org_settings" (
  "id"                varchar PRIMARY KEY DEFAULT 'default',
  "screenshot_policy" jsonb,
  "updated_at"        timestamp DEFAULT now()
);

-- Seed the default row so GET always returns something without an INSERT first
INSERT INTO "org_settings" ("id") VALUES ('default') ON CONFLICT DO NOTHING;

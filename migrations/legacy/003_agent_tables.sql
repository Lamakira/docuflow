-- Migration 003: Desktop Agent tables
-- Creates devices, agent_pairing_codes, agent_processed_batches, agent_activity_events
-- Run this if the database was provisioned before the desktop agent was added.

CREATE TABLE IF NOT EXISTS "devices" (
  "id"                 varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"            varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name"               varchar(255) NOT NULL,
  "os"                 varchar(100),
  "client_version"     varchar(50),
  "device_token_hash"  varchar(64) NOT NULL,
  "last_seen_at"       timestamp,
  "revoked_at"         timestamp,
  "created_at"         timestamp DEFAULT now()
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

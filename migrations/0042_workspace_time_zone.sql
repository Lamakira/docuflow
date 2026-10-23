-- The Workspace time zone (#341). The Daily Update nudge and the reader
-- notifications count the Workday in it. Every existing row takes
-- America/Toronto, the zone the nudge was hard-coded to, so nothing changes
-- until an Administrator picks another.
--
-- IF NOT EXISTS: a database built by drizzle-kit push from current
-- shared/schema.ts already has the column (tests/smoke/migrations.test.ts).
ALTER TABLE "org_settings" ADD COLUMN IF NOT EXISTS "time_zone" varchar(64) DEFAULT 'America/Toronto' NOT NULL;

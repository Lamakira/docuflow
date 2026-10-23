-- Perceptual fingerprint of each capture (#341): a 64-bit difference hash as
-- 16 hex digits, written at upload and by scripts/backfill-screenshot-fingerprints.ts.
-- Null until computed, and for a capture whose image cannot be read: such a
-- capture is never Similar. `content_hash` stays for exact duplicates.
--
-- The index serves "the previous capture of the same Member", the Similar lookup.
--
-- IF NOT EXISTS: a database built by drizzle-kit push from current
-- shared/schema.ts already has both (tests/smoke/migrations.test.ts).
ALTER TABLE "time_entry_screenshots" ADD COLUMN IF NOT EXISTS "perceptual_hash" varchar(16);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_screenshots_user_captured" ON "time_entry_screenshots" USING btree ("workspace_id","user_id","captured_at");

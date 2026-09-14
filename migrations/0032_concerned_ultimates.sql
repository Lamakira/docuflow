-- org_settings held one row for the whole product: `id` was the primary key and
-- defaulted to 'default', so a second Workspace saving its Tracking Policy or
-- its Screencasts timezone list overwrote the first Workspace's row. The key
-- becomes the (workspace_id, id) pair so each Workspace keeps its own settings.
--
-- Safe on existing data: every row already carries a NOT NULL workspace_id, and
-- there is at most one row per Workspace to promote.
--
-- Both statements are tolerant because the journal is also replayed onto a
-- database built by `drizzle-kit push` from the current schema, where the new
-- key already exists and the old one never did (tests/smoke/migrations.test.ts).
ALTER TABLE "org_settings" DROP CONSTRAINT IF EXISTS "org_settings_pkey";--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'org_settings_workspace_id_id_pk'
  ) THEN
    ALTER TABLE "org_settings"
      ADD CONSTRAINT "org_settings_workspace_id_id_pk" PRIMARY KEY("workspace_id","id");
  END IF;
END $$;

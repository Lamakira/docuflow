-- Ingest time through Timer Commands and stamp legacy Time Entries (#117,
-- ADR-0009, Spec #112). Time owns Timer, Time Entry, and Work Schedule. New
-- start/stop/adjust work is an append-only Timer Command (origin, per-origin
-- sequence, claimed effective time, Workspace scope). Existing Time Entries
-- keep their rows with provenance `legacy`; the journal does not invent
-- Timer Commands for them. At most one active Timer per User.
--
-- IF NOT EXISTS / duplicate_object: a database built by drizzle-kit push from
-- current shared/schema.ts already has these objects, and the
-- baseline-then-apply path in tests/smoke/migrations.test.ts must treat the
-- DDL as the no-op it is there. The legacy stamp is journaled SQL — the same
-- recorded exception to ADR-0017 as #92 / #114 — because provenance has to
-- land with the schema for the smoke seam.
CREATE TABLE IF NOT EXISTS "timer_commands" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"origin" varchar(128) NOT NULL,
	"sequence" bigint NOT NULL,
	"kind" varchar(20) NOT NULL,
	"claimed_effective_at" timestamp NOT NULL,
	"received_at" timestamp NOT NULL,
	"clamped" boolean DEFAULT false NOT NULL,
	"time_entry_id" varchar,
	"payload" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"workspace_id" varchar NOT NULL,
	CONSTRAINT "idx_timer_commands_id_workspace" UNIQUE("id","workspace_id")
);
--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN IF NOT EXISTS "provenance" varchar(20) DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN IF NOT EXISTS "timer_command_id" varchar;--> statement-breakpoint
UPDATE "time_entries" SET "provenance" = 'legacy' WHERE "provenance" IS DISTINCT FROM 'command';--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "timer_commands" ADD CONSTRAINT "timer_commands_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
	WHEN duplicate_table THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "timer_commands" ADD CONSTRAINT "timer_commands_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
	WHEN duplicate_table THEN NULL;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_timer_commands_origin_sequence" ON "timer_commands" USING btree ("workspace_id","origin","sequence");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_timer_commands_user" ON "timer_commands" USING btree ("user_id","claimed_effective_at");--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_timer_command_id_timer_commands_id_fk" FOREIGN KEY ("timer_command_id") REFERENCES "public"."timer_commands"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
	WHEN duplicate_table THEN NULL;
END $$;
--> statement-breakpoint
-- Keep the latest active Timer per User; stop extras so the partial unique
-- index can land on databases that already have overlapping running rows.
UPDATE "time_entries" SET "status" = 'stopped', "end_time" = COALESCE("end_time", "updated_at", now())
WHERE "id" IN (
	SELECT "id" FROM (
		SELECT "id", row_number() OVER (PARTITION BY "user_id" ORDER BY "start_time" DESC) AS rn
		FROM "time_entries"
		WHERE "status" IN ('running', 'paused')
	) extras WHERE extras.rn > 1
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_time_entries_one_active_timer_per_user" ON "time_entries" USING btree ("user_id") WHERE "time_entries"."status" IN ('running', 'paused');--> statement-breakpoint
ALTER TABLE "timer_commands" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS workspace_isolation ON "timer_commands";--> statement-breakpoint
CREATE POLICY workspace_isolation ON "timer_commands"
	FOR ALL
	TO PUBLIC
	USING (workspace_id = current_setting('app.workspace_id', true))
	WITH CHECK (workspace_id = current_setting('app.workspace_id', true));

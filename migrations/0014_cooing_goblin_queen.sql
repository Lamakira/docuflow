-- Knowledge object-storage port and Index Artifacts (#116, ADR-0012, Spec #112).
-- Two-phase signed-PUT slots, fail-closed File scan, hold flag. Existing Files
-- stay `available` on their current object keys — no re-key. Index Artifacts
-- are derived Intelligence rows rebuilt from Document and File, never a source
-- of truth and never wider than Document Access.
--
-- IF NOT EXISTS / duplicate_object: a database built by drizzle-kit push from
-- current shared/schema.ts already has these objects, and the
-- baseline-then-apply path in tests/smoke/migrations.test.ts must treat the
-- DDL as the no-op it is there.
CREATE TABLE IF NOT EXISTS "index_artifacts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_kind" varchar(20) NOT NULL,
	"source_id" varchar NOT NULL,
	"source_revision" varchar(64) NOT NULL,
	"chunk_index" integer DEFAULT 0 NOT NULL,
	"chunk_text" text NOT NULL,
	"access" varchar(50) DEFAULT 'workspace' NOT NULL,
	"provenance" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"workspace_id" varchar NOT NULL,
	CONSTRAINT "idx_index_artifacts_id_workspace" UNIQUE("id","workspace_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "object_upload_slots" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"object_path" varchar(1000) NOT NULL,
	"created_by_id" varchar NOT NULL,
	"expires_at" timestamp NOT NULL,
	"finalized_at" timestamp,
	"file_id" varchar,
	"created_at" timestamp DEFAULT now(),
	"workspace_id" varchar NOT NULL,
	CONSTRAINT "idx_object_upload_slots_id_workspace" UNIQUE("id","workspace_id")
);
--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN IF NOT EXISTS "scan_status" varchar(20) DEFAULT 'available' NOT NULL;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN IF NOT EXISTS "hold" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "index_artifacts" ADD CONSTRAINT "index_artifacts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
	WHEN duplicate_table THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "object_upload_slots" ADD CONSTRAINT "object_upload_slots_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
	WHEN duplicate_table THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "object_upload_slots" ADD CONSTRAINT "object_upload_slots_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
	WHEN duplicate_table THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "object_upload_slots" ADD CONSTRAINT "object_upload_slots_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
	WHEN duplicate_table THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "object_upload_slots" ADD CONSTRAINT "object_upload_slots_file_workspace_fk" FOREIGN KEY ("file_id","workspace_id") REFERENCES "public"."files"("id","workspace_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
	WHEN duplicate_table THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_index_artifacts_source" ON "index_artifacts" USING btree ("source_kind","source_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_object_upload_slots_path" ON "object_upload_slots" USING btree ("object_path");--> statement-breakpoint
ALTER TABLE "index_artifacts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS workspace_isolation ON "index_artifacts";--> statement-breakpoint
CREATE POLICY workspace_isolation ON "index_artifacts"
	FOR ALL
	TO PUBLIC
	USING (workspace_id = current_setting('app.workspace_id', true))
	WITH CHECK (workspace_id = current_setting('app.workspace_id', true));--> statement-breakpoint
ALTER TABLE "object_upload_slots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS workspace_isolation ON "object_upload_slots";--> statement-breakpoint
CREATE POLICY workspace_isolation ON "object_upload_slots"
	FOR ALL
	TO PUBLIC
	USING (workspace_id = current_setting('app.workspace_id', true))
	WITH CHECK (workspace_id = current_setting('app.workspace_id', true));

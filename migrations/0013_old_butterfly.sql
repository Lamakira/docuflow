-- Split Document from File (#115, ADR-0012, Spec #112). Knowledge owns both.
-- An edited page stays a Document (`company_documents` content / `documents`).
-- An uploaded binary becomes a File. Combined `company_documents` stays the
-- HTTP row so characterization does not move. Legacy ids and object keys copy
-- onto `files`. Document Access defaults to everyone in the Workspace.
-- Embeddings are dropped here as a data-model consequence; Index Artifacts
-- rebuild in #116. Activity still owns evidence metadata.
--
-- IF NOT EXISTS / duplicate_object: a database built by drizzle-kit push from
-- current shared/schema.ts already has these objects, and the
-- baseline-then-apply path in tests/smoke/migrations.test.ts must treat the
-- DDL as the no-op it is there. The backfill and embedding truncate are
-- journaled SQL — the same recorded exception to ADR-0017 as #92 / #114 —
-- because the split has to land with the schema for the smoke seam.
CREATE TABLE IF NOT EXISTS "files" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(500) NOT NULL,
	"description" text,
	"file_name" varchar(500),
	"file_size" integer,
	"mime_type" varchar(100),
	"storage_path" varchar(1000) NOT NULL,
	"folder_id" varchar,
	"uploaded_by_id" varchar NOT NULL,
	"access" varchar(50) DEFAULT 'workspace' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"workspace_id" varchar NOT NULL,
	CONSTRAINT "idx_files_id_workspace" UNIQUE("id","workspace_id")
);
--> statement-breakpoint
ALTER TABLE "company_documents" ADD COLUMN IF NOT EXISTS "access" varchar(50) DEFAULT 'workspace' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "files" ADD CONSTRAINT "files_folder_id_company_document_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."company_document_folders"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
	WHEN duplicate_table THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "files" ADD CONSTRAINT "files_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
	WHEN duplicate_table THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "files" ADD CONSTRAINT "files_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
	WHEN duplicate_table THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "files" ADD CONSTRAINT "files_folder_workspace_fk" FOREIGN KEY ("folder_id","workspace_id") REFERENCES "public"."company_document_folders"("id","workspace_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
	WHEN duplicate_table THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_files_uploaded_by" ON "files" USING btree ("uploaded_by_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_files_folder" ON "files" USING btree ("folder_id");--> statement-breakpoint
INSERT INTO "files" (
	"id", "name", "description", "file_name", "file_size", "mime_type",
	"storage_path", "folder_id", "uploaded_by_id", "access",
	"created_at", "updated_at", "workspace_id"
)
SELECT
	"id", "name", "description", "file_name", "file_size", "mime_type",
	"storage_path", "folder_id", "uploaded_by_id", COALESCE("access", 'workspace'),
	"created_at", "updated_at", "workspace_id"
FROM "company_documents"
WHERE "storage_path" IS NOT NULL
	AND "storage_path" <> ''
	AND NOT EXISTS (
		SELECT 1 FROM "files" f WHERE f."id" = "company_documents"."id"
	);--> statement-breakpoint
DELETE FROM "company_document_embeddings";--> statement-breakpoint
DELETE FROM "document_embeddings";--> statement-breakpoint
ALTER TABLE "files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS workspace_isolation ON "files";--> statement-breakpoint
CREATE POLICY workspace_isolation ON "files"
	FOR ALL
	TO PUBLIC
	USING (workspace_id = current_setting('app.workspace_id', true))
	WITH CHECK (workspace_id = current_setting('app.workspace_id', true));

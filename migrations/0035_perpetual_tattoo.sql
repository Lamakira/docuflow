-- Document Access on Workspace Documents, Files, and Folders (#278): Everyone,
-- Restricted to named Members, or Administrators only. A Folder now carries a
-- level too, and everything filed in it is at least that closed. Project Files
-- (#278) are `files` rows with a `project_id`.
--
-- Existing values keep what they meant: `workspace` stays Everyone, `everyone`
-- (accepted as its synonym) becomes `workspace`, and anything else, which no
-- register listed, becomes Administrators only rather than opening up. Every
-- Folder starts at Everyone, which is what every Folder was.
--
-- IF NOT EXISTS / duplicate_object: a database built by drizzle-kit push from
-- current shared/schema.ts already has these objects, and the
-- baseline-then-apply path in tests/smoke/migrations.test.ts must treat the
-- DDL as the no-op it is there.
CREATE TABLE IF NOT EXISTS "document_access_members" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"folder_id" varchar,
	"document_id" varchar,
	"user_id" varchar NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"workspace_id" varchar NOT NULL,
	CONSTRAINT "idx_document_access_members_id_workspace" UNIQUE("id","workspace_id")
);
--> statement-breakpoint
ALTER TABLE "company_document_folders" ADD COLUMN IF NOT EXISTS "access" varchar(50) DEFAULT 'workspace' NOT NULL;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN IF NOT EXISTS "project_id" varchar;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "document_access_members" ADD CONSTRAINT "document_access_members_folder_id_company_document_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."company_document_folders"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
	WHEN duplicate_table THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "document_access_members" ADD CONSTRAINT "document_access_members_document_id_company_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."company_documents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
	WHEN duplicate_table THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "document_access_members" ADD CONSTRAINT "document_access_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
	WHEN duplicate_table THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "document_access_members" ADD CONSTRAINT "document_access_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
	WHEN duplicate_table THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "document_access_members" ADD CONSTRAINT "document_access_members_folder_workspace_fk" FOREIGN KEY ("folder_id","workspace_id") REFERENCES "public"."company_document_folders"("id","workspace_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
	WHEN duplicate_table THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "document_access_members" ADD CONSTRAINT "document_access_members_document_workspace_fk" FOREIGN KEY ("document_id","workspace_id") REFERENCES "public"."company_documents"("id","workspace_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
	WHEN duplicate_table THEN NULL;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_document_access_members_folder_user" ON "document_access_members" USING btree ("folder_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_document_access_members_document_user" ON "document_access_members" USING btree ("document_id","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_document_access_members_user" ON "document_access_members" USING btree ("user_id");--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "files" ADD CONSTRAINT "files_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
	WHEN duplicate_table THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "files" ADD CONSTRAINT "files_project_workspace_fk" FOREIGN KEY ("project_id","workspace_id") REFERENCES "public"."projects"("id","workspace_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
	WHEN duplicate_table THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_files_project" ON "files" USING btree ("project_id");--> statement-breakpoint
UPDATE "company_documents" SET "access" = 'workspace' WHERE "access" = 'everyone';--> statement-breakpoint
UPDATE "company_documents" SET "access" = 'administrators' WHERE "access" NOT IN ('workspace', 'restricted', 'administrators');--> statement-breakpoint
UPDATE "files" SET "access" = 'workspace' WHERE "access" = 'everyone';--> statement-breakpoint
UPDATE "files" SET "access" = 'administrators' WHERE "access" NOT IN ('workspace', 'restricted', 'administrators');--> statement-breakpoint
ALTER TABLE "document_access_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS workspace_isolation ON "document_access_members";--> statement-breakpoint
CREATE POLICY workspace_isolation ON "document_access_members"
	FOR ALL
	TO PUBLIC
	USING (workspace_id = current_setting('app.workspace_id', true))
	WITH CHECK (workspace_id = current_setting('app.workspace_id', true));

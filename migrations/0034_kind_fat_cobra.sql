-- A Workspace Documents Folder can sit inside another, at any depth (#273).
-- Null parent is the Workspace root. Deleting a Folder deletes the Folders
-- inside it, as it already deletes what is filed in it. The composite FK keeps
-- a parent in the same Workspace (#96).
--
-- IF NOT EXISTS / duplicate_object: a database built by drizzle-kit push from
-- current shared/schema.ts already has these objects, and the
-- baseline-then-apply path in tests/smoke/migrations.test.ts must treat the
-- DDL as the no-op it is there.
ALTER TABLE "company_document_folders" ADD COLUMN IF NOT EXISTS "parent_id" varchar;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "company_document_folders" ADD CONSTRAINT "company_document_folders_parent_id_company_document_folders_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."company_document_folders"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
	WHEN duplicate_table THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "company_document_folders" ADD CONSTRAINT "company_document_folders_parent_workspace_fk" FOREIGN KEY ("parent_id","workspace_id") REFERENCES "public"."company_document_folders"("id","workspace_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
	WHEN duplicate_table THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_company_document_folders_parent" ON "company_document_folders" USING btree ("parent_id");

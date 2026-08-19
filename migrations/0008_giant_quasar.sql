-- Workspace-owned `workspace_id` backfill (#94, ADR-0006, ADR-0017). Nullable
-- column on every Workspace-owned table, then a SQL backfill from aggregate
-- roots outward onto the seeded Workspace. Device Enrollment connects each
-- existing Device through the owner's Membership. The verifier reports
-- remaining nulls; this migration does not apply `NOT NULL` (#96).
--
-- Jobs and Dead Letters already have a nullable column from #82; this fills
-- Phase 3 rows. Seed and backfill run as journaled SQL — the recorded
-- exception to ADR-0017's "data movement is a script" rule (Spec #92).
--
-- `IF NOT EXISTS` throughout: a database built by `drizzle-kit push` from
-- current `shared/schema.ts` already has these objects, and the
-- baseline-then-apply path in `tests/smoke/migrations.test.ts` must treat
-- the DDL as the no-op it is there.
CREATE TABLE IF NOT EXISTS "device_enrollments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" varchar NOT NULL,
	"workspace_id" varchar NOT NULL,
	"membership_id" varchar NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "agent_activity_events" ADD COLUMN IF NOT EXISTS "workspace_id" varchar;
--> statement-breakpoint
ALTER TABLE "agent_pairing_codes" ADD COLUMN IF NOT EXISTS "workspace_id" varchar;
--> statement-breakpoint
ALTER TABLE "agent_processed_batches" ADD COLUMN IF NOT EXISTS "workspace_id" varchar;
--> statement-breakpoint
ALTER TABLE "audio_recordings" ADD COLUMN IF NOT EXISTS "workspace_id" varchar;
--> statement-breakpoint
ALTER TABLE "company_document_embeddings" ADD COLUMN IF NOT EXISTS "workspace_id" varchar;
--> statement-breakpoint
ALTER TABLE "company_document_folders" ADD COLUMN IF NOT EXISTS "workspace_id" varchar;
--> statement-breakpoint
ALTER TABLE "company_documents" ADD COLUMN IF NOT EXISTS "workspace_id" varchar;
--> statement-breakpoint
ALTER TABLE "crm_clients" ADD COLUMN IF NOT EXISTS "workspace_id" varchar;
--> statement-breakpoint
ALTER TABLE "crm_contacts" ADD COLUMN IF NOT EXISTS "workspace_id" varchar;
--> statement-breakpoint
ALTER TABLE "crm_custom_field_values" ADD COLUMN IF NOT EXISTS "workspace_id" varchar;
--> statement-breakpoint
ALTER TABLE "crm_module_fields" ADD COLUMN IF NOT EXISTS "workspace_id" varchar;
--> statement-breakpoint
ALTER TABLE "crm_modules" ADD COLUMN IF NOT EXISTS "workspace_id" varchar;
--> statement-breakpoint
ALTER TABLE "crm_project_notes" ADD COLUMN IF NOT EXISTS "workspace_id" varchar;
--> statement-breakpoint
ALTER TABLE "crm_project_stage_history" ADD COLUMN IF NOT EXISTS "workspace_id" varchar;
--> statement-breakpoint
ALTER TABLE "crm_project_tags" ADD COLUMN IF NOT EXISTS "workspace_id" varchar;
--> statement-breakpoint
ALTER TABLE "crm_projects" ADD COLUMN IF NOT EXISTS "workspace_id" varchar;
--> statement-breakpoint
ALTER TABLE "crm_tags" ADD COLUMN IF NOT EXISTS "workspace_id" varchar;
--> statement-breakpoint
ALTER TABLE "document_embeddings" ADD COLUMN IF NOT EXISTS "workspace_id" varchar;
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "workspace_id" varchar;
--> statement-breakpoint
ALTER TABLE "membership_capabilities" ADD COLUMN IF NOT EXISTS "workspace_id" varchar;
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "workspace_id" varchar;
--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN IF NOT EXISTS "workspace_id" varchar;
--> statement-breakpoint
ALTER TABLE "project_daily_updates" ADD COLUMN IF NOT EXISTS "workspace_id" varchar;
--> statement-breakpoint
ALTER TABLE "project_members" ADD COLUMN IF NOT EXISTS "workspace_id" varchar;
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "workspace_id" varchar;
--> statement-breakpoint
ALTER TABLE "reminders" ADD COLUMN IF NOT EXISTS "workspace_id" varchar;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "workspace_id" varchar;
--> statement-breakpoint
ALTER TABLE "team_invites" ADD COLUMN IF NOT EXISTS "workspace_id" varchar;
--> statement-breakpoint
ALTER TABLE "team_members" ADD COLUMN IF NOT EXISTS "workspace_id" varchar;
--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN IF NOT EXISTS "workspace_id" varchar;
--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN IF NOT EXISTS "workspace_id" varchar;
--> statement-breakpoint
ALTER TABLE "time_entry_screenshots" ADD COLUMN IF NOT EXISTS "workspace_id" varchar;
--> statement-breakpoint
ALTER TABLE "video_transcripts" ADD COLUMN IF NOT EXISTS "workspace_id" varchar;
--> statement-breakpoint
ALTER TABLE "workspace_role_capabilities" ADD COLUMN IF NOT EXISTS "workspace_id" varchar;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "device_enrollments" ADD CONSTRAINT "device_enrollments_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "device_enrollments" ADD CONSTRAINT "device_enrollments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "device_enrollments" ADD CONSTRAINT "device_enrollments_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_device_enrollments_device_workspace" ON "device_enrollments" USING btree ("device_id","workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_device_enrollments_workspace" ON "device_enrollments" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_device_enrollments_membership" ON "device_enrollments" USING btree ("membership_id");
--> statement-breakpoint
-- Roots: stamp the seeded Workspace. Children inherit from those parents next.
UPDATE "projects" SET "workspace_id" = 'seeded' WHERE "workspace_id" IS NULL;
--> statement-breakpoint
UPDATE "crm_clients" SET "workspace_id" = 'seeded' WHERE "workspace_id" IS NULL;
--> statement-breakpoint
UPDATE "crm_modules" SET "workspace_id" = 'seeded' WHERE "workspace_id" IS NULL;
--> statement-breakpoint
UPDATE "crm_tags" SET "workspace_id" = 'seeded' WHERE "workspace_id" IS NULL;
--> statement-breakpoint
UPDATE "teams" SET "workspace_id" = 'seeded' WHERE "workspace_id" IS NULL;
--> statement-breakpoint
UPDATE "org_settings" SET "workspace_id" = 'seeded' WHERE "workspace_id" IS NULL;
--> statement-breakpoint
UPDATE "company_document_folders" SET "workspace_id" = 'seeded' WHERE "workspace_id" IS NULL;
--> statement-breakpoint
UPDATE "jobs" SET "workspace_id" = 'seeded' WHERE "workspace_id" IS NULL;
--> statement-breakpoint
UPDATE "dead_letters" SET "workspace_id" = 'seeded' WHERE "workspace_id" IS NULL;
--> statement-breakpoint
UPDATE "agent_pairing_codes" SET "workspace_id" = 'seeded' WHERE "workspace_id" IS NULL;
--> statement-breakpoint
UPDATE "workspace_role_capabilities" wrc
SET "workspace_id" = wr."workspace_id"
FROM "workspace_roles" wr
WHERE wrc."workspace_role_id" = wr."id" AND wrc."workspace_id" IS NULL;
--> statement-breakpoint
UPDATE "membership_capabilities" mc
SET "workspace_id" = m."workspace_id"
FROM "memberships" m
WHERE mc."membership_id" = m."id" AND mc."workspace_id" IS NULL;
--> statement-breakpoint
UPDATE "documents" d
SET "workspace_id" = p."workspace_id"
FROM "projects" p
WHERE d."project_id" = p."id" AND d."workspace_id" IS NULL;
--> statement-breakpoint
UPDATE "crm_projects" cp
SET "workspace_id" = p."workspace_id"
FROM "projects" p
WHERE cp."project_id" = p."id" AND cp."workspace_id" IS NULL;
--> statement-breakpoint
UPDATE "crm_contacts" c
SET "workspace_id" = cl."workspace_id"
FROM "crm_clients" cl
WHERE c."client_id" = cl."id" AND c."workspace_id" IS NULL;
--> statement-breakpoint
UPDATE "crm_module_fields" f
SET "workspace_id" = m."workspace_id"
FROM "crm_modules" m
WHERE f."module_id" = m."id" AND f."workspace_id" IS NULL;
--> statement-breakpoint
UPDATE "team_members" tm
SET "workspace_id" = t."workspace_id"
FROM "teams" t
WHERE tm."team_id" = t."id" AND tm."workspace_id" IS NULL;
--> statement-breakpoint
UPDATE "team_invites" ti
SET "workspace_id" = t."workspace_id"
FROM "teams" t
WHERE ti."team_id" = t."id" AND ti."workspace_id" IS NULL;
--> statement-breakpoint
UPDATE "company_documents" d
SET "workspace_id" = f."workspace_id"
FROM "company_document_folders" f
WHERE d."folder_id" = f."id" AND d."workspace_id" IS NULL;
--> statement-breakpoint
UPDATE "document_embeddings" e
SET "workspace_id" = d."workspace_id"
FROM "documents" d
WHERE e."document_id" = d."id" AND e."workspace_id" IS NULL;
--> statement-breakpoint
UPDATE "video_transcripts" v
SET "workspace_id" = d."workspace_id"
FROM "documents" d
WHERE v."document_id" = d."id" AND v."workspace_id" IS NULL;
--> statement-breakpoint
UPDATE "audio_recordings" a
SET "workspace_id" = d."workspace_id"
FROM "documents" d
WHERE a."document_id" = d."id" AND a."workspace_id" IS NULL;
--> statement-breakpoint
UPDATE "company_document_embeddings" e
SET "workspace_id" = d."workspace_id"
FROM "company_documents" d
WHERE e."company_document_id" = d."id" AND e."workspace_id" IS NULL;
--> statement-breakpoint
UPDATE "tasks" t
SET "workspace_id" = cp."workspace_id"
FROM "crm_projects" cp
WHERE t."crm_project_id" = cp."id" AND t."workspace_id" IS NULL;
--> statement-breakpoint
UPDATE "project_members" pm
SET "workspace_id" = cp."workspace_id"
FROM "crm_projects" cp
WHERE pm."crm_project_id" = cp."id" AND pm."workspace_id" IS NULL;
--> statement-breakpoint
UPDATE "reminders" r
SET "workspace_id" = cp."workspace_id"
FROM "crm_projects" cp
WHERE r."crm_project_id" = cp."id" AND r."workspace_id" IS NULL;
--> statement-breakpoint
UPDATE "time_entries" te
SET "workspace_id" = cp."workspace_id"
FROM "crm_projects" cp
WHERE te."crm_project_id" = cp."id" AND te."workspace_id" IS NULL;
--> statement-breakpoint
UPDATE "crm_project_notes" n
SET "workspace_id" = cp."workspace_id"
FROM "crm_projects" cp
WHERE n."crm_project_id" = cp."id" AND n."workspace_id" IS NULL;
--> statement-breakpoint
UPDATE "crm_project_stage_history" h
SET "workspace_id" = cp."workspace_id"
FROM "crm_projects" cp
WHERE h."crm_project_id" = cp."id" AND h."workspace_id" IS NULL;
--> statement-breakpoint
UPDATE "crm_project_tags" pt
SET "workspace_id" = cp."workspace_id"
FROM "crm_projects" cp
WHERE pt."crm_project_id" = cp."id" AND pt."workspace_id" IS NULL;
--> statement-breakpoint
UPDATE "crm_custom_field_values" v
SET "workspace_id" = cp."workspace_id"
FROM "crm_projects" cp
WHERE v."crm_project_id" = cp."id" AND v."workspace_id" IS NULL;
--> statement-breakpoint
UPDATE "project_daily_updates" u
SET "workspace_id" = cp."workspace_id"
FROM "crm_projects" cp
WHERE u."crm_project_id" = cp."id" AND u."workspace_id" IS NULL;
--> statement-breakpoint
UPDATE "notifications" n
SET "workspace_id" = cp."workspace_id"
FROM "crm_projects" cp
WHERE n."crm_project_id" = cp."id" AND n."workspace_id" IS NULL;
--> statement-breakpoint
UPDATE "time_entry_screenshots" s
SET "workspace_id" = te."workspace_id"
FROM "time_entries" te
WHERE s."time_entry_id" = te."id" AND s."workspace_id" IS NULL;
--> statement-breakpoint
UPDATE "agent_activity_events" e
SET "workspace_id" = te."workspace_id"
FROM "time_entries" te
WHERE e."time_entry_id" = te."id" AND e."workspace_id" IS NULL;
--> statement-breakpoint
-- Orphans and rows with no parent still belong to the seeded Workspace.
UPDATE "documents" SET "workspace_id" = 'seeded' WHERE "workspace_id" IS NULL;
--> statement-breakpoint
UPDATE "crm_projects" SET "workspace_id" = 'seeded' WHERE "workspace_id" IS NULL;
--> statement-breakpoint
UPDATE "crm_contacts" SET "workspace_id" = 'seeded' WHERE "workspace_id" IS NULL;
--> statement-breakpoint
UPDATE "crm_module_fields" SET "workspace_id" = 'seeded' WHERE "workspace_id" IS NULL;
--> statement-breakpoint
UPDATE "team_members" SET "workspace_id" = 'seeded' WHERE "workspace_id" IS NULL;
--> statement-breakpoint
UPDATE "team_invites" SET "workspace_id" = 'seeded' WHERE "workspace_id" IS NULL;
--> statement-breakpoint
UPDATE "company_documents" SET "workspace_id" = 'seeded' WHERE "workspace_id" IS NULL;
--> statement-breakpoint
UPDATE "document_embeddings" SET "workspace_id" = 'seeded' WHERE "workspace_id" IS NULL;
--> statement-breakpoint
UPDATE "video_transcripts" SET "workspace_id" = 'seeded' WHERE "workspace_id" IS NULL;
--> statement-breakpoint
UPDATE "audio_recordings" SET "workspace_id" = 'seeded' WHERE "workspace_id" IS NULL;
--> statement-breakpoint
UPDATE "company_document_embeddings" SET "workspace_id" = 'seeded' WHERE "workspace_id" IS NULL;
--> statement-breakpoint
UPDATE "tasks" SET "workspace_id" = 'seeded' WHERE "workspace_id" IS NULL;
--> statement-breakpoint
UPDATE "project_members" SET "workspace_id" = 'seeded' WHERE "workspace_id" IS NULL;
--> statement-breakpoint
UPDATE "reminders" SET "workspace_id" = 'seeded' WHERE "workspace_id" IS NULL;
--> statement-breakpoint
UPDATE "time_entries" SET "workspace_id" = 'seeded' WHERE "workspace_id" IS NULL;
--> statement-breakpoint
UPDATE "crm_project_notes" SET "workspace_id" = 'seeded' WHERE "workspace_id" IS NULL;
--> statement-breakpoint
UPDATE "crm_project_stage_history" SET "workspace_id" = 'seeded' WHERE "workspace_id" IS NULL;
--> statement-breakpoint
UPDATE "crm_project_tags" SET "workspace_id" = 'seeded' WHERE "workspace_id" IS NULL;
--> statement-breakpoint
UPDATE "crm_custom_field_values" SET "workspace_id" = 'seeded' WHERE "workspace_id" IS NULL;
--> statement-breakpoint
UPDATE "project_daily_updates" SET "workspace_id" = 'seeded' WHERE "workspace_id" IS NULL;
--> statement-breakpoint
UPDATE "notifications" SET "workspace_id" = 'seeded' WHERE "workspace_id" IS NULL;
--> statement-breakpoint
UPDATE "time_entry_screenshots" SET "workspace_id" = 'seeded' WHERE "workspace_id" IS NULL;
--> statement-breakpoint
UPDATE "agent_activity_events" SET "workspace_id" = 'seeded' WHERE "workspace_id" IS NULL;
--> statement-breakpoint
UPDATE "agent_processed_batches" SET "workspace_id" = 'seeded' WHERE "workspace_id" IS NULL;
--> statement-breakpoint
UPDATE "workspace_role_capabilities" SET "workspace_id" = 'seeded' WHERE "workspace_id" IS NULL;
--> statement-breakpoint
UPDATE "membership_capabilities" SET "workspace_id" = 'seeded' WHERE "workspace_id" IS NULL;
--> statement-breakpoint
INSERT INTO "device_enrollments" ("device_id", "workspace_id", "membership_id")
SELECT d."id", m."workspace_id", m."id"
FROM "devices" d
JOIN "memberships" m ON m."user_id" = d."user_id" AND m."workspace_id" = 'seeded'
ON CONFLICT ("device_id", "workspace_id") DO NOTHING;

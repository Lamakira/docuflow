-- Opportunity fields (#276) on the row behind an Opportunity: its Opportunity
-- Owner (who sold it, apart from the Project Manager in `assignee_id`), its
-- Source (the Pipeline & lists Source value), its Estimated value as money in
-- the currency's minor units with an ISO 4217 code, and the Lost reason with an
-- optional detail. The Estimated value is not the hours budget
-- (`budgeted_hours` / `budgeted_minutes`) and nothing copies one into the other.
--
-- The Owner starts as the row's assignee wherever the row has an Opportunity,
-- which is who the pipeline showed as responsible until now. Re-running it
-- changes nothing: it only fills an Owner still unset.
--
-- IF NOT EXISTS: a database built by drizzle-kit push from current
-- shared/schema.ts already has these columns, and the baseline-then-apply path
-- in tests/smoke/migrations.test.ts must treat the DDL as the no-op it is there.
ALTER TABLE "crm_projects" ADD COLUMN IF NOT EXISTS "opportunity_owner_id" varchar;--> statement-breakpoint
ALTER TABLE "crm_projects" ADD COLUMN IF NOT EXISTS "source" varchar(50);--> statement-breakpoint
ALTER TABLE "crm_projects" ADD COLUMN IF NOT EXISTS "estimated_value_minor" bigint;--> statement-breakpoint
ALTER TABLE "crm_projects" ADD COLUMN IF NOT EXISTS "estimated_value_currency" varchar(3);--> statement-breakpoint
ALTER TABLE "crm_projects" ADD COLUMN IF NOT EXISTS "lost_reason" varchar(50);--> statement-breakpoint
ALTER TABLE "crm_projects" ADD COLUMN IF NOT EXISTS "lost_reason_detail" text;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "crm_projects" ADD CONSTRAINT "crm_projects_opportunity_owner_id_users_id_fk" FOREIGN KEY ("opportunity_owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
UPDATE "crm_projects"
SET "opportunity_owner_id" = "assignee_id"
WHERE "opportunity_owner_id" IS NULL
	AND "assignee_id" IS NOT NULL
	AND "project_type" IS DISTINCT FROM 'internal'
	AND COALESCE("is_documentation_only", 0) = 0
	AND "status" <> 'documented';

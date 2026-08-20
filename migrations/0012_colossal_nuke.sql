-- Split Opportunity from Project (#114, ADR-0001, Spec #112). Clients & Sales
-- owns Opportunity; Projects owns Project (`crm_projects` keeps legacy ids).
-- Combined `crm_projects.status` stays the HTTP lifecycle so characterization
-- does not move. `project_status` is Project Status. Pipeline stage lives on
-- `opportunities.stage`. Won and Lost are fixed terminals. Internal Projects,
-- `is_documentation_only` rows, and status `documented` get no Opportunity.
--
-- IF NOT EXISTS / duplicate_object: a database built by drizzle-kit push from
-- current shared/schema.ts already has these objects, and the
-- baseline-then-apply path in tests/smoke/migrations.test.ts must treat the
-- DDL as the no-op it is there. The backfill is journaled SQL — the same
-- recorded exception to ADR-0017 as #92 — because the split has to land with
-- the schema for the smoke seam.
CREATE TABLE IF NOT EXISTS "opportunities" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"crm_project_id" varchar,
	"client_id" varchar,
	"stage" varchar(50) NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"workspace_id" varchar NOT NULL,
	CONSTRAINT "idx_opportunities_id_workspace" UNIQUE("id","workspace_id")
);
--> statement-breakpoint
ALTER TABLE "crm_projects" ADD COLUMN IF NOT EXISTS "project_status" varchar(50) DEFAULT 'planned' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_crm_project_id_crm_projects_id_fk" FOREIGN KEY ("crm_project_id") REFERENCES "public"."crm_projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
	WHEN duplicate_table THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_client_id_crm_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."crm_clients"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
	WHEN duplicate_table THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
	WHEN duplicate_table THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_project_workspace_fk" FOREIGN KEY ("crm_project_id","workspace_id") REFERENCES "public"."crm_projects"("id","workspace_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
	WHEN duplicate_table THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_opportunities_project" ON "opportunities" USING btree ("crm_project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_opportunities_client" ON "opportunities" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_opportunities_stage" ON "opportunities" USING btree ("stage");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_opportunities_crm_project" ON "opportunities" USING btree ("crm_project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_crm_projects_project_status" ON "crm_projects" USING btree ("project_status");--> statement-breakpoint
UPDATE "crm_projects" SET "project_status" = CASE "status"
	WHEN 'won_in_progress' THEN 'active'
	WHEN 'won_in_review' THEN 'in_review'
	WHEN 'won_completed' THEN 'completed'
	WHEN 'lost' THEN 'archived'
	WHEN 'won_cancelled' THEN 'archived'
	ELSE 'planned'
END;--> statement-breakpoint
INSERT INTO "opportunities" ("id", "crm_project_id", "client_id", "stage", "workspace_id")
SELECT gen_random_uuid(), "id", "client_id",
	CASE "status"
		WHEN 'won' THEN 'won'
		WHEN 'won_not_started' THEN 'won'
		WHEN 'won_in_progress' THEN 'won'
		WHEN 'won_in_review' THEN 'won'
		WHEN 'won_completed' THEN 'won'
		WHEN 'won_cancelled' THEN 'won'
		WHEN 'lost' THEN 'lost'
		ELSE "status"
	END,
	"workspace_id"
FROM "crm_projects"
WHERE COALESCE("is_documentation_only", 0) = 0
	AND COALESCE("project_type", 'one_time') <> 'internal'
	AND COALESCE("status", '') <> 'documented'
	AND NOT EXISTS (
		SELECT 1 FROM "opportunities" o WHERE o."crm_project_id" = "crm_projects"."id"
	);--> statement-breakpoint
ALTER TABLE "opportunities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS workspace_isolation ON "opportunities";--> statement-breakpoint
CREATE POLICY workspace_isolation ON "opportunities"
	FOR ALL
	TO PUBLIC
	USING (workspace_id = current_setting('app.workspace_id', true))
	WITH CHECK (workspace_id = current_setting('app.workspace_id', true));

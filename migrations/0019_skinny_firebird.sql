-- Webhook Endpoints (#129, ADR-0008, ADR-0011, Spec #125).
-- Workspace owns the target URL, HMAC key material, event filter, and
-- enable/disable. Identity owns the catalog row Service Accounts grant.
-- Delivery is #130.
--
-- IF NOT EXISTS / duplicate_object: a database built by drizzle-kit push from
-- current shared/schema.ts already has these objects, and the
-- baseline-then-apply path in tests/smoke/migrations.test.ts must treat the
-- DDL as the no-op it is there.
CREATE TABLE IF NOT EXISTS "webhook_endpoints" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"url" text NOT NULL,
	"hmac_secret" varchar(128) NOT NULL,
	"event_types" jsonb NOT NULL,
	"disabled_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"workspace_id" varchar NOT NULL,
	CONSTRAINT "idx_webhook_endpoints_id_workspace" UNIQUE("id","workspace_id")
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
	WHEN duplicate_table THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_webhook_endpoints_workspace" ON "webhook_endpoints" USING btree ("workspace_id");--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS workspace_isolation ON "webhook_endpoints";--> statement-breakpoint
CREATE POLICY workspace_isolation ON "webhook_endpoints"
	FOR ALL
	TO PUBLIC
	USING (workspace_id = current_setting('app.workspace_id', true))
	WITH CHECK (workspace_id = current_setting('app.workspace_id', true));--> statement-breakpoint
INSERT INTO "capabilities" ("id", "name")
VALUES ('webhook_endpoints_manage', 'Manage Webhook Endpoints')
ON CONFLICT ("id") DO NOTHING;

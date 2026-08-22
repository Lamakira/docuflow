-- Plan Registry, billing pin, Entitlement overrides, and Audit Events
-- (#139, ADR-0008, ADR-0010, Spec #138). Billing owns the pin and overrides.
-- Audit Events are append-only evidence, not Outbox Events. The seeded
-- Workspace is pinned to Plan `legacy` at registry version 1, Active, with
-- no Stripe objects.
--
-- IF NOT EXISTS / duplicate_object: a database built by drizzle-kit push from
-- current shared/schema.ts already has these objects, and the
-- baseline-then-apply path in tests/smoke/migrations.test.ts must treat the
-- DDL as the no-op it is there.
CREATE TABLE IF NOT EXISTS "audit_events" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" varchar NOT NULL,
	"actor_kind" varchar(32) NOT NULL,
	"actor_id" varchar,
	"action" varchar(100) NOT NULL,
	"resource_type" varchar(100) NOT NULL,
	"resource_id" varchar,
	"payload" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "idx_audit_events_id_workspace" UNIQUE("id","workspace_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspace_billing" (
	"workspace_id" varchar PRIMARY KEY NOT NULL,
	"plan_key" varchar(32) NOT NULL,
	"registry_version" integer NOT NULL,
	"billing_state" varchar(32) NOT NULL,
	"purchased_seat_capacity" integer NOT NULL,
	"authorization_version" integer DEFAULT 1 NOT NULL,
	"stripe_customer_id" varchar,
	"stripe_subscription_id" varchar,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspace_entitlement_overrides" (
	"workspace_id" varchar PRIMARY KEY NOT NULL,
	"seat_capacity" integer,
	"service_account_requests_per_minute" integer,
	"workspace_requests_per_minute" integer,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
	WHEN duplicate_table THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "workspace_billing" ADD CONSTRAINT "workspace_billing_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
	WHEN duplicate_table THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "workspace_entitlement_overrides" ADD CONSTRAINT "workspace_entitlement_overrides_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
	WHEN duplicate_table THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_audit_events_workspace_created" ON "audit_events" USING btree ("workspace_id","created_at");--> statement-breakpoint
ALTER TABLE "audit_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS workspace_isolation ON "audit_events";--> statement-breakpoint
CREATE POLICY workspace_isolation ON "audit_events"
	FOR ALL
	TO PUBLIC
	USING (workspace_id = current_setting('app.workspace_id', true))
	WITH CHECK (workspace_id = current_setting('app.workspace_id', true));--> statement-breakpoint
ALTER TABLE "workspace_billing" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS workspace_isolation ON "workspace_billing";--> statement-breakpoint
CREATE POLICY workspace_isolation ON "workspace_billing"
	FOR ALL
	TO PUBLIC
	USING (workspace_id = current_setting('app.workspace_id', true))
	WITH CHECK (workspace_id = current_setting('app.workspace_id', true));--> statement-breakpoint
ALTER TABLE "workspace_entitlement_overrides" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS workspace_isolation ON "workspace_entitlement_overrides";--> statement-breakpoint
CREATE POLICY workspace_isolation ON "workspace_entitlement_overrides"
	FOR ALL
	TO PUBLIC
	USING (workspace_id = current_setting('app.workspace_id', true))
	WITH CHECK (workspace_id = current_setting('app.workspace_id', true));--> statement-breakpoint
INSERT INTO "workspace_billing" (
	"workspace_id", "plan_key", "registry_version", "billing_state",
	"purchased_seat_capacity", "authorization_version"
)
SELECT 'seeded', 'legacy', 1, 'Active', 500, 1
WHERE EXISTS (SELECT 1 FROM "workspaces" WHERE "id" = 'seeded')
ON CONFLICT ("workspace_id") DO NOTHING;

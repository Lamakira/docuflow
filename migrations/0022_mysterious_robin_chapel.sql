-- Stripe webhook inbox, Outbox Events, and Subscription lookup (#143,
-- ADR-0010, ADR-0013). Inbox is platform-scoped (provider event id is the
-- dedupe key). Outbox Events are Workspace-owned consequences, not Audit
-- Events. HTTP never applies Entitlements from this migration.
--
-- IF NOT EXISTS / duplicate_object: a database built by drizzle-kit push from
-- current shared/schema.ts already has these objects, and the
-- baseline-then-apply path in tests/smoke/migrations.test.ts must treat the
-- DDL as the no-op it is there.
CREATE TABLE IF NOT EXISTS "billing_webhook_inbox" (
	"provider_event_id" varchar PRIMARY KEY NOT NULL,
	"type" varchar(100) NOT NULL,
	"object_id" varchar NOT NULL,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"processed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "outbox_events" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" varchar NOT NULL,
	"type" varchar(100) NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"occurred_at" timestamp DEFAULT now() NOT NULL,
	"actor_kind" varchar(32) NOT NULL,
	"actor_id" varchar,
	"aggregate_type" varchar(100) NOT NULL,
	"aggregate_id" varchar NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "idx_outbox_events_id_workspace" UNIQUE("id","workspace_id")
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
	WHEN duplicate_table THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_outbox_events_workspace_occurred" ON "outbox_events" USING btree ("workspace_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_workspace_billing_stripe_subscription" ON "workspace_billing" USING btree ("stripe_subscription_id");--> statement-breakpoint
ALTER TABLE "outbox_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS workspace_isolation ON "outbox_events";--> statement-breakpoint
CREATE POLICY workspace_isolation ON "outbox_events"
	FOR ALL
	TO PUBLIC
	USING (workspace_id = current_setting('app.workspace_id', true))
	WITH CHECK (workspace_id = current_setting('app.workspace_id', true));

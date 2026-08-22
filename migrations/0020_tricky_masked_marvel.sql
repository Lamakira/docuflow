-- Outbox Events and Audit Events (#130, ADR-0011, ADR-0013, Spec #125).
-- Domain writes append an Outbox Event in the same transaction; the Worker
-- dispatcher fans each out as Jobs. Replay of webhook delivery is an audited
-- command. HTTP does not deliver.
--
-- IF NOT EXISTS / duplicate_object: a database built by drizzle-kit push from
-- current shared/schema.ts already has these objects, and the
-- baseline-then-apply path in tests/smoke/migrations.test.ts must treat the
-- DDL as the no-op it is there.
CREATE TABLE IF NOT EXISTS "audit_events" (
	"id" varchar PRIMARY KEY NOT NULL,
	"type" varchar(64) NOT NULL,
	"occurred_at" timestamp NOT NULL,
	"workspace_id" varchar NOT NULL,
	"principal_kind" varchar(32),
	"principal_id" varchar,
	"resource_type" varchar(64) NOT NULL,
	"resource_id" varchar NOT NULL,
	"payload" jsonb NOT NULL,
	CONSTRAINT "idx_audit_events_id_workspace" UNIQUE("id","workspace_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "outbox_events" (
	"id" varchar PRIMARY KEY NOT NULL,
	"type" varchar(64) NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"occurred_at" timestamp NOT NULL,
	"workspace_id" varchar NOT NULL,
	"principal_kind" varchar(32),
	"principal_id" varchar,
	"aggregate_type" varchar(32) NOT NULL,
	"aggregate_id" varchar NOT NULL,
	"payload" jsonb NOT NULL,
	"dispatched_at" timestamp,
	CONSTRAINT "idx_outbox_events_id_workspace" UNIQUE("id","workspace_id")
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
	ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
	WHEN duplicate_table THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_audit_events_workspace" ON "audit_events" USING btree ("workspace_id","occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_outbox_events_undispatched" ON "outbox_events" USING btree ("occurred_at","id") WHERE "outbox_events"."dispatched_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_outbox_events_workspace" ON "outbox_events" USING btree ("workspace_id");--> statement-breakpoint
ALTER TABLE "audit_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS workspace_isolation ON "audit_events";--> statement-breakpoint
CREATE POLICY workspace_isolation ON "audit_events"
	FOR ALL
	TO PUBLIC
	USING (workspace_id = current_setting('app.workspace_id', true))
	WITH CHECK (workspace_id = current_setting('app.workspace_id', true));--> statement-breakpoint
ALTER TABLE "outbox_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS workspace_isolation ON "outbox_events";--> statement-breakpoint
CREATE POLICY workspace_isolation ON "outbox_events"
	FOR ALL
	TO PUBLIC
	USING (workspace_id = current_setting('app.workspace_id', true))
	WITH CHECK (workspace_id = current_setting('app.workspace_id', true));

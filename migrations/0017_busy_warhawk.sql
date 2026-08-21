-- Public `/api/v1` Idempotency-Key stored-response replay (#126, ADR-0011).
-- HTTP contract infrastructure, not a domain module. Scoped to one Service
-- Account in one Workspace. Optional on mutating requests.
--
-- IF NOT EXISTS / duplicate_object: a database built by drizzle-kit push from
-- current shared/schema.ts already has these objects, and the
-- baseline-then-apply path in tests/smoke/migrations.test.ts must treat the
-- DDL as the no-op it is there.
CREATE TABLE IF NOT EXISTS "public_api_idempotency_keys" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_account_id" varchar NOT NULL,
	"idempotency_key" varchar(255) NOT NULL,
	"method" varchar(16) NOT NULL,
	"path" varchar(512) NOT NULL,
	"status" integer NOT NULL,
	"body" jsonb NOT NULL,
	"content_type" varchar(128) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"workspace_id" varchar NOT NULL,
	CONSTRAINT "idx_public_api_idempotency_keys_id_workspace" UNIQUE("id","workspace_id")
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "public_api_idempotency_keys" ADD CONSTRAINT "public_api_idempotency_keys_service_account_id_service_accounts_id_fk" FOREIGN KEY ("service_account_id") REFERENCES "public"."service_accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
	WHEN duplicate_table THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "public_api_idempotency_keys" ADD CONSTRAINT "public_api_idempotency_keys_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
	WHEN duplicate_table THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "public_api_idempotency_keys" ADD CONSTRAINT "public_api_idempotency_keys_account_workspace_fk" FOREIGN KEY ("service_account_id","workspace_id") REFERENCES "public"."service_accounts"("id","workspace_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
	WHEN duplicate_table THEN NULL;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_public_api_idempotency_key" ON "public_api_idempotency_keys" USING btree ("workspace_id","service_account_id","idempotency_key");
--> statement-breakpoint
ALTER TABLE "public_api_idempotency_keys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS workspace_isolation ON "public_api_idempotency_keys";--> statement-breakpoint
CREATE POLICY workspace_isolation ON "public_api_idempotency_keys"
	FOR ALL
	TO PUBLIC
	USING (workspace_id = current_setting('app.workspace_id', true))
	WITH CHECK (workspace_id = current_setting('app.workspace_id', true));

-- Service Accounts and PrincipalContext (#131, ADR-0008, ADR-0011, Spec #125).
-- Identity & Access owns the non-human identity. The plaintext API key is never
-- a column; only the SHA-256 hash is stored. Capabilities are granted
-- explicitly. A Service Account is not a Membership.
--
-- IF NOT EXISTS / duplicate_object: a database built by drizzle-kit push from
-- current shared/schema.ts already has these objects, and the
-- baseline-then-apply path in tests/smoke/migrations.test.ts must treat the
-- DDL as the no-op it is there.
CREATE TABLE IF NOT EXISTS "service_account_capabilities" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_account_id" varchar NOT NULL,
	"capability_id" varchar NOT NULL,
	"workspace_id" varchar DEFAULT 'seeded' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "service_accounts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"key_hash" varchar(64) NOT NULL,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"workspace_id" varchar NOT NULL,
	CONSTRAINT "idx_service_accounts_id_workspace" UNIQUE("id","workspace_id")
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "service_account_capabilities" ADD CONSTRAINT "service_account_capabilities_service_account_id_service_accounts_id_fk" FOREIGN KEY ("service_account_id") REFERENCES "public"."service_accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
	WHEN duplicate_table THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "service_account_capabilities" ADD CONSTRAINT "service_account_capabilities_capability_id_capabilities_id_fk" FOREIGN KEY ("capability_id") REFERENCES "public"."capabilities"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
	WHEN duplicate_table THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "service_account_capabilities" ADD CONSTRAINT "service_account_capabilities_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
	WHEN duplicate_table THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "service_account_capabilities" ADD CONSTRAINT "service_account_capabilities_account_workspace_fk" FOREIGN KEY ("service_account_id","workspace_id") REFERENCES "public"."service_accounts"("id","workspace_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
	WHEN duplicate_table THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "service_accounts" ADD CONSTRAINT "service_accounts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
	WHEN duplicate_table THEN NULL;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_service_account_capabilities_unique" ON "service_account_capabilities" USING btree ("service_account_id","capability_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_service_accounts_key_hash" ON "service_accounts" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_service_accounts_workspace" ON "service_accounts" USING btree ("workspace_id");--> statement-breakpoint
ALTER TABLE "service_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS workspace_isolation ON "service_accounts";--> statement-breakpoint
CREATE POLICY workspace_isolation ON "service_accounts"
	FOR ALL
	TO PUBLIC
	USING (workspace_id = current_setting('app.workspace_id', true))
	WITH CHECK (workspace_id = current_setting('app.workspace_id', true));--> statement-breakpoint
ALTER TABLE "service_account_capabilities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS workspace_isolation ON "service_account_capabilities";--> statement-breakpoint
CREATE POLICY workspace_isolation ON "service_account_capabilities"
	FOR ALL
	TO PUBLIC
	USING (workspace_id = current_setting('app.workspace_id', true))
	WITH CHECK (workspace_id = current_setting('app.workspace_id', true));

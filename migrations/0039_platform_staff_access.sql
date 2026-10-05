-- Platform Staff, Support Access Grants, and Workspace two-factor (#300, ADR-0015).
--
-- Platform Staff are not Users. `users.role = 'admin'` stops being operator
-- authority: those accounts are copied into `platform_staff` and the column is
-- no longer read by the operator gate. Grants are Workspace-scoped and
-- read-only. Break-glass is the only other way in, and it is audited.
--
-- IF NOT EXISTS / duplicate_object: a database built by drizzle-kit push from
-- current shared/schema.ts already has these objects, and the
-- baseline-then-apply path in tests/smoke/migrations.test.ts must treat the
-- DDL as the no-op it is there.
CREATE TABLE IF NOT EXISTS "platform_staff" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_id" varchar NOT NULL,
	"email" varchar,
	"linked_user_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "platform_staff_subject_id_unique" UNIQUE("subject_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "support_access_grants" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform_staff_id" varchar NOT NULL,
	"created_by_user_id" varchar NOT NULL,
	"expires_at" timestamp NOT NULL,
	"revoked_at" timestamp,
	"revoked_by_user_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"workspace_id" varchar NOT NULL,
	CONSTRAINT "idx_support_access_grants_id_workspace" UNIQUE("id","workspace_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "break_glass_access" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform_staff_id" varchar NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"workspace_id" varchar NOT NULL,
	CONSTRAINT "idx_break_glass_access_id_workspace" UNIQUE("id","workspace_id")
);
--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN IF NOT EXISTS "require_two_factor" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "platform_staff" ADD CONSTRAINT "platform_staff_linked_user_id_users_id_fk" FOREIGN KEY ("linked_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "support_access_grants" ADD CONSTRAINT "support_access_grants_platform_staff_id_platform_staff_id_fk" FOREIGN KEY ("platform_staff_id") REFERENCES "public"."platform_staff"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "support_access_grants" ADD CONSTRAINT "support_access_grants_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "support_access_grants" ADD CONSTRAINT "support_access_grants_revoked_by_user_id_users_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "support_access_grants" ADD CONSTRAINT "support_access_grants_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "break_glass_access" ADD CONSTRAINT "break_glass_access_platform_staff_id_platform_staff_id_fk" FOREIGN KEY ("platform_staff_id") REFERENCES "public"."platform_staff"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "break_glass_access" ADD CONSTRAINT "break_glass_access_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_support_access_grants_staff" ON "support_access_grants" USING btree ("workspace_id","platform_staff_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_break_glass_access_staff" ON "break_glass_access" USING btree ("workspace_id","platform_staff_id");--> statement-breakpoint
ALTER TABLE "support_access_grants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS workspace_isolation ON "support_access_grants";--> statement-breakpoint
CREATE POLICY workspace_isolation ON "support_access_grants"
	FOR ALL
	TO PUBLIC
	USING (workspace_id = current_setting('app.workspace_id', true))
	WITH CHECK (workspace_id = current_setting('app.workspace_id', true));--> statement-breakpoint
ALTER TABLE "break_glass_access" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS workspace_isolation ON "break_glass_access";--> statement-breakpoint
CREATE POLICY workspace_isolation ON "break_glass_access"
	FOR ALL
	TO PUBLIC
	USING (workspace_id = current_setting('app.workspace_id', true))
	WITH CHECK (workspace_id = current_setting('app.workspace_id', true));--> statement-breakpoint
INSERT INTO "platform_staff" ("subject_id", "email", "linked_user_id")
SELECT
	COALESCE(NULLIF("identity_provider_subject_id", ''), 'migrated-user:' || "id"),
	"email",
	"id"
FROM "users"
WHERE "role" = 'admin'
ON CONFLICT ("subject_id") DO NOTHING;

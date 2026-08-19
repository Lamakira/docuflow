-- Workspace seam seed (#93, ADR-0006, ADR-0017). Tables for Workspace,
-- Membership, the three built-in Workspace Roles, and Capabilities, then one
-- named Workspace (`seeded`) and a Membership per existing user. Tracking
-- Policy is copied from `org_settings`; that row is not dropped. HTTP still
-- authenticates as today and does not read these tables.
--
-- Seed and mapping run as journaled SQL — the recorded exception to
-- ADR-0017's "data movement is a script" rule, because the Reserved VM Worker
-- (#86) is deferred and Autoscale will not claim a Job (Spec #92).
--
-- `IF NOT EXISTS` throughout: a database built by `drizzle-kit push` from
-- current `shared/schema.ts` already has these objects, and the
-- baseline-then-apply path in `tests/smoke/migrations.test.ts` must treat the
-- DDL as the no-op it is there. Constraint names match what drizzle-kit
-- generate emitted; each add is skipped when the constraint already exists.
CREATE TABLE IF NOT EXISTS "capabilities" (
	"id" varchar PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspaces" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"screenshot_policy" jsonb,
	"allowed_timezones" jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspace_roles" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" varchar NOT NULL,
	"slug" varchar(50) NOT NULL,
	"name" varchar(100) NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspace_role_capabilities" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_role_id" varchar NOT NULL,
	"capability_id" varchar NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "memberships" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"workspace_role_id" varchar NOT NULL,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "membership_capabilities" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"membership_id" varchar NOT NULL,
	"capability_id" varchar NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "workspace_roles" ADD CONSTRAINT "workspace_roles_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "workspace_role_capabilities" ADD CONSTRAINT "workspace_role_capabilities_workspace_role_id_workspace_roles_id_fk" FOREIGN KEY ("workspace_role_id") REFERENCES "public"."workspace_roles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "workspace_role_capabilities" ADD CONSTRAINT "workspace_role_capabilities_capability_id_capabilities_id_fk" FOREIGN KEY ("capability_id") REFERENCES "public"."capabilities"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "memberships" ADD CONSTRAINT "memberships_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "memberships" ADD CONSTRAINT "memberships_workspace_role_id_workspace_roles_id_fk" FOREIGN KEY ("workspace_role_id") REFERENCES "public"."workspace_roles"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "membership_capabilities" ADD CONSTRAINT "membership_capabilities_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "membership_capabilities" ADD CONSTRAINT "membership_capabilities_capability_id_capabilities_id_fk" FOREIGN KEY ("capability_id") REFERENCES "public"."capabilities"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_membership_capabilities_unique" ON "membership_capabilities" USING btree ("membership_id","capability_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_memberships_workspace_user" ON "memberships" USING btree ("workspace_id","user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_memberships_workspace" ON "memberships" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_memberships_user" ON "memberships" USING btree ("user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_workspace_role_capabilities_unique" ON "workspace_role_capabilities" USING btree ("workspace_role_id","capability_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_workspace_roles_workspace_slug" ON "workspace_roles" USING btree ("workspace_id","slug");
--> statement-breakpoint
INSERT INTO "capabilities" ("id", "name")
VALUES ('view_daily_updates', 'View daily updates')
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "workspaces" ("id", "name", "screenshot_policy", "allowed_timezones")
VALUES (
	'seeded',
	'DocuFlow',
	(SELECT "screenshot_policy" FROM "org_settings" WHERE "id" = 'default'),
	(SELECT "allowed_timezones" FROM "org_settings" WHERE "id" = 'default')
)
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "workspace_roles" ("id", "workspace_id", "slug", "name")
VALUES
	('seeded-owner', 'seeded', 'owner', 'Owner'),
	('seeded-administrator', 'seeded', 'administrator', 'Administrator'),
	('seeded-member', 'seeded', 'member', 'Member')
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "workspace_role_capabilities" ("workspace_role_id", "capability_id")
SELECT "id", 'view_daily_updates'
FROM "workspace_roles"
WHERE "workspace_id" = 'seeded' AND "slug" IN ('owner', 'administrator')
ON CONFLICT ("workspace_role_id", "capability_id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "memberships" ("workspace_id", "user_id", "workspace_role_id", "archived_at")
SELECT
	'seeded',
	u."id",
	CASE
		WHEN u."id" = (
			SELECT "id" FROM "users"
			WHERE "is_main_admin" = 1
			ORDER BY "created_at" ASC NULLS LAST, "id" ASC
			LIMIT 1
		) THEN 'seeded-owner'
		WHEN u."role" = 'admin' THEN 'seeded-administrator'
		ELSE 'seeded-member'
	END,
	CASE WHEN u."is_archived" THEN now() ELSE NULL END
FROM "users" u
ON CONFLICT ("workspace_id", "user_id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "membership_capabilities" ("membership_id", "capability_id")
SELECT m."id", 'view_daily_updates'
FROM "memberships" m
JOIN "users" u ON u."id" = m."user_id"
WHERE u."can_view_daily_updates" = 1
	AND NOT EXISTS (
		SELECT 1
		FROM "workspace_role_capabilities" wrc
		WHERE wrc."workspace_role_id" = m."workspace_role_id"
			AND wrc."capability_id" = 'view_daily_updates'
	)
ON CONFLICT ("membership_id", "capability_id") DO NOTHING;

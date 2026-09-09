-- Persisted Active Workspace preference on the User (#183). Not tenancy:
-- `users` stays global. NULL means the User has not chosen; HTTP then uses a
-- stable fallback. ON DELETE SET NULL so a removed Workspace cannot pin a User.
--
-- IF NOT EXISTS / duplicate_object: a database built by drizzle-kit push from
-- current shared/schema.ts already has these objects, and the
-- baseline-then-apply path in tests/smoke/migrations.test.ts must treat the
-- DDL as the no-op it is there.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "active_workspace_id" varchar;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "users" ADD CONSTRAINT "users_active_workspace_id_workspaces_id_fk" FOREIGN KEY ("active_workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
	WHEN duplicate_table THEN NULL;
END $$;

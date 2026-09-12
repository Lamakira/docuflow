-- Workspace Invitation (#211, Flow 6). Pending consumes no Billable Seat.
-- Acceptance creates a Membership, not a Workspace.
--
-- IF NOT EXISTS / duplicate_object: a database built by drizzle-kit push from
-- current shared/schema.ts already has these objects, and the
-- baseline-then-apply path in tests/smoke/migrations.test.ts must treat the
-- DDL as the no-op it is there.
CREATE TABLE IF NOT EXISTS "invitations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" varchar NOT NULL,
	"email" varchar NOT NULL,
	"workspace_role_id" varchar NOT NULL,
	"token" varchar(64) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"invited_by_user_id" varchar NOT NULL,
	"expires_at" timestamp NOT NULL,
	"accepted_at" timestamp,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "idx_invitations_id_workspace" UNIQUE("id","workspace_id")
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "invitations" ADD CONSTRAINT "invitations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
	WHEN duplicate_table THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "invitations" ADD CONSTRAINT "invitations_workspace_role_id_workspace_roles_id_fk" FOREIGN KEY ("workspace_role_id") REFERENCES "public"."workspace_roles"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
	WHEN duplicate_table THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
	WHEN duplicate_table THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "invitations" ADD CONSTRAINT "invitations_role_workspace_fk" FOREIGN KEY ("workspace_role_id","workspace_id") REFERENCES "public"."workspace_roles"("id","workspace_id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
	WHEN duplicate_table THEN NULL;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_invitations_token" ON "invitations" USING btree ("token");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_invitations_workspace_email" ON "invitations" USING btree ("workspace_id","email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_invitations_workspace" ON "invitations" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_invitations_email" ON "invitations" USING btree ("email");--> statement-breakpoint
ALTER TABLE "invitations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS workspace_isolation ON "invitations";--> statement-breakpoint
CREATE POLICY workspace_isolation ON "invitations"
	FOR ALL
	TO PUBLIC
	USING (workspace_id = current_setting('app.workspace_id', true))
	WITH CHECK (workspace_id = current_setting('app.workspace_id', true));

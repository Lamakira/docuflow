-- Simultaneous Timers (#400, ADR-0031).
--
-- The one-active-Timer-per-User index becomes one per User per Task (per
-- Project for a Timer without a Task); every existing row satisfies both, as
-- the old index was stricter. The cap of three and the single Workspace are
-- checked at start under the User's lock, not by an index.
-- time_entry_screenshot_timers attaches a capture to every other Timer that ran
-- when it was taken. devices.agent_protocol_version records what each Device
-- declares, to warn Members before the minimum rises.
-- app_active_time_entries_for_user is the locator for all of a User's active
-- Timers, as app_active_time_entry_for_user (0041) is for the latest one.
DO $$
DECLARE
	table_owner text;
	is_super boolean;
	is_bypass boolean;
BEGIN
	SELECT pg_get_userbyid(relowner) INTO table_owner FROM pg_class WHERE oid = 'public.memberships'::regclass;
	SELECT rolsuper, rolbypassrls INTO is_super, is_bypass FROM pg_roles WHERE rolname = current_user;
	IF table_owner IS DISTINCT FROM current_user
		AND NOT coalesce(is_super, false)
		AND NOT coalesce(is_bypass, false)
		AND NOT pg_has_role(current_user, table_owner, 'USAGE') THEN
		RAISE EXCEPTION 'migration 0045 must run as the owner of memberships (%), not %: SECURITY DEFINER locators must be owned by the table owner (or a role RLS treats as it) or RLS applies inside them and they silently return nothing', table_owner, current_user;
	END IF;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "time_entry_screenshot_timers" (
	"screenshot_id" varchar NOT NULL,
	"time_entry_id" varchar NOT NULL,
	"crm_project_id" varchar NOT NULL,
	"workspace_id" varchar NOT NULL,
	CONSTRAINT "time_entry_screenshot_timers_screenshot_id_time_entry_id_pk" PRIMARY KEY("screenshot_id","time_entry_id")
);
--> statement-breakpoint
DROP INDEX IF EXISTS "idx_time_entries_one_active_timer_per_user";--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "agent_protocol_version" integer;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "time_entry_screenshot_timers" ADD CONSTRAINT "time_entry_screenshot_timers_screenshot_id_time_entry_screenshots_id_fk" FOREIGN KEY ("screenshot_id") REFERENCES "public"."time_entry_screenshots"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "time_entry_screenshot_timers" ADD CONSTRAINT "time_entry_screenshot_timers_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "time_entry_screenshot_timers" ADD CONSTRAINT "screenshot_timers_time_entry_workspace_fk" FOREIGN KEY ("time_entry_id","workspace_id") REFERENCES "public"."time_entries"("id","workspace_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "time_entry_screenshot_timers" ADD CONSTRAINT "screenshot_timers_project_workspace_fk" FOREIGN KEY ("crm_project_id","workspace_id") REFERENCES "public"."crm_projects"("id","workspace_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_screenshot_timers_time_entry" ON "time_entry_screenshot_timers" USING btree ("time_entry_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_screenshot_timers_project" ON "time_entry_screenshot_timers" USING btree ("crm_project_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_time_entries_one_active_timer_per_task" ON "time_entries" USING btree ("user_id","task_id") WHERE "time_entries"."status" IN ('running', 'paused') AND "time_entries"."task_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_time_entries_one_taskless_timer_per_project" ON "time_entries" USING btree ("user_id","crm_project_id") WHERE "time_entries"."status" IN ('running', 'paused') AND "time_entries"."task_id" IS NULL;--> statement-breakpoint
ALTER TABLE "time_entry_screenshot_timers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS workspace_isolation ON "time_entry_screenshot_timers";--> statement-breakpoint
CREATE POLICY workspace_isolation ON "time_entry_screenshot_timers"
	FOR ALL
	TO PUBLIC
	USING (workspace_id = current_setting('app.workspace_id', true))
	WITH CHECK (workspace_id = current_setting('app.workspace_id', true));--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_active_time_entries_for_user(p_user_id varchar)
RETURNS TABLE (id varchar, workspace_id varchar)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
	SELECT t.id, t.workspace_id
		FROM public.time_entries t
		WHERE t.user_id = p_user_id AND t.status IN ('running', 'paused')
		ORDER BY t.start_time DESC, t.id
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app_active_time_entries_for_user(varchar) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_active_time_entries_for_user(varchar) TO docuflow_app;

-- Workspace locators and the jobs queue exemption (#323, ADR-0006).
--
-- Row-level security (0010) matches no row until app.workspace_id is set, and
-- the Workspace is not known until a User, Device, pairing code, API key,
-- invitation email, invitation token, or a User's Timer has been resolved to
-- one. These nine functions are that resolution: SECURITY DEFINER, fixed column lists, one
-- lookup key each, executable by docuflow_app only. They run as the function
-- owner, so the owner must be the owner of the tables (or a superuser):
-- otherwise RLS applies inside them and they silently return nothing.
--
-- jobs and dead_letters are a queue the Worker claims across Workspaces; they
-- carry a nullable workspace_id and no customer-entered text, so they leave RLS.
--
-- CREATE OR REPLACE / DROP POLICY IF EXISTS: re-running is a no-op.
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
		RAISE EXCEPTION 'migration 0041 must run as the owner of memberships (%), not %: SECURITY DEFINER locators must be owned by the table owner (or a role RLS treats as it) or RLS applies inside them and they silently return nothing', table_owner, current_user;
	END IF;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_memberships_for_user(p_user_id varchar)
RETURNS TABLE (id varchar, workspace_id varchar, user_id varchar, workspace_role_id varchar, archived_at timestamp, created_at timestamp)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
	SELECT m.id, m.workspace_id, m.user_id, m.workspace_role_id, m.archived_at, m.created_at
		FROM public.memberships m
		WHERE m.user_id = p_user_id
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app_memberships_for_user(varchar) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_memberships_for_user(varchar) TO docuflow_app;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_enrollment_for_device(p_device_id varchar)
RETURNS TABLE (workspace_id varchar, membership_id varchar, user_id varchar, archived_at timestamp)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
	SELECT e.workspace_id, e.membership_id, m.user_id, m.archived_at
		FROM public.device_enrollments e
		JOIN public.memberships m ON m.id = e.membership_id
		WHERE e.device_id = p_device_id
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app_enrollment_for_device(varchar) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_enrollment_for_device(varchar) TO docuflow_app;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_workspace_for_pairing_code(p_code varchar)
RETURNS TABLE (id varchar, workspace_id varchar)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
	SELECT c.id, c.workspace_id
		FROM public.agent_pairing_codes c
		WHERE c.code = p_code
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app_workspace_for_pairing_code(varchar) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_workspace_for_pairing_code(varchar) TO docuflow_app;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_workspace_for_api_key(p_key_hash varchar)
RETURNS TABLE (id varchar, workspace_id varchar, revoked_at timestamp)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
	SELECT s.id, s.workspace_id, s.revoked_at
		FROM public.service_accounts s
		WHERE s.key_hash = p_key_hash
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app_workspace_for_api_key(varchar) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_workspace_for_api_key(varchar) TO docuflow_app;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_invitations_for_email(p_email varchar)
RETURNS TABLE (id varchar, workspace_id varchar, status varchar, expires_at timestamp)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
	SELECT i.id, i.workspace_id, i.status, i.expires_at
		FROM public.invitations i
		WHERE i.email = p_email AND i.status = 'pending' AND i.expires_at > (now() AT TIME ZONE 'UTC')
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app_invitations_for_email(varchar) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_invitations_for_email(varchar) TO docuflow_app;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_invitation_for_token(p_token varchar)
RETURNS TABLE (id varchar, workspace_id varchar)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
	SELECT i.id, i.workspace_id
		FROM public.invitations i
		WHERE i.token = p_token
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app_invitation_for_token(varchar) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_invitation_for_token(varchar) TO docuflow_app;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_active_time_entry_for_user(p_user_id varchar)
RETURNS TABLE (id varchar, workspace_id varchar)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
	SELECT t.id, t.workspace_id
		FROM public.time_entries t
		WHERE t.user_id = p_user_id AND t.status IN ('running', 'paused')
		ORDER BY t.start_time DESC
		LIMIT 1
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app_active_time_entry_for_user(varchar) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_active_time_entry_for_user(varchar) TO docuflow_app;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_time_entry_workspace_for_user(p_id varchar, p_user_id varchar)
RETURNS TABLE (workspace_id varchar)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
	SELECT t.workspace_id
		FROM public.time_entries t
		WHERE t.id = p_id AND t.user_id = p_user_id
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app_time_entry_workspace_for_user(varchar, varchar) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_time_entry_workspace_for_user(varchar, varchar) TO docuflow_app;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_notification_workspace_for_user(p_id varchar, p_user_id varchar)
RETURNS TABLE (workspace_id varchar)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
	SELECT n.workspace_id
		FROM public.notifications n
		WHERE n.id = p_id AND n.user_id = p_user_id
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app_notification_workspace_for_user(varchar, varchar) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_notification_workspace_for_user(varchar, varchar) TO docuflow_app;
--> statement-breakpoint
DROP POLICY IF EXISTS workspace_isolation ON jobs;
--> statement-breakpoint
ALTER TABLE jobs DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS workspace_isolation ON dead_letters;
--> statement-breakpoint
ALTER TABLE dead_letters DISABLE ROW LEVEL SECURITY;

-- Workspace RLS (#97, ADR-0006, ADR-0017). After query scoping (#95) and the
-- NOT NULL tighten (#96), enable row-level security on every Workspace-owned
-- table. The application role (`docuflow_app`) cannot bypass RLS. The table
-- owner still can, so today's DATABASE_URL (HTTP/Worker) is unchanged until
-- that URL is pointed at docuflow_app and DATABASE_MIGRATE_URL holds the
-- owner. Missing app.workspace_id matches no row (fail closed).
--
-- IF NOT EXISTS / DROP POLICY IF EXISTS: a database that already has these
-- objects, or that was built by drizzle-kit push then baselined, is a no-op.

DO $$ BEGIN
	CREATE ROLE docuflow_app NOINHERIT NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE LOGIN;
EXCEPTION
	WHEN duplicate_object THEN
		ALTER ROLE docuflow_app NOINHERIT NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE LOGIN;
END $$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO docuflow_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO docuflow_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO docuflow_app;
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON TABLE schema_migrations FROM docuflow_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO docuflow_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO docuflow_app;
--> statement-breakpoint
DO $$
DECLARE
	owned text;
BEGIN
	FOR owned IN
		SELECT c.table_name
		  FROM information_schema.columns c
		 WHERE c.table_schema = 'public'
		   AND c.column_name = 'workspace_id'
		 ORDER BY c.table_name
	LOOP
		EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', owned);
		EXECUTE format('DROP POLICY IF EXISTS workspace_isolation ON %I', owned);
		EXECUTE format(
			$policy$
			CREATE POLICY workspace_isolation ON %I
			  FOR ALL
			  TO PUBLIC
			  USING (workspace_id = current_setting('app.workspace_id', true))
			  WITH CHECK (workspace_id = current_setting('app.workspace_id', true))
			$policy$,
			owned
		);
	END LOOP;
END $$;

-- The application role for local development (#323). Row-level security applies
-- to it, so a query that forgets its Workspace context fails here, not in
-- production. Migration 0010 finds this role and keeps it; it only runs on a
-- fresh volume. An existing volume gets the password from `npm run db:app-role`.
CREATE ROLE docuflow_app NOINHERIT NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE LOGIN
  PASSWORD 'docuflow_app_dev';

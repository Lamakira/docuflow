-- Snapshot Teams into evidence and drop them (#98, ADR-0017, Spec #92).
-- Identities (ids, names, membership ids — never invite codes) are recorded
-- in docs/migration/phase-4-teams-snapshot.md. Teams are not converted into
-- Project Assignments; project_members is untouched.
--
-- IF EXISTS: a database built by drizzle-kit push from current
-- shared/schema.ts already lacks these tables, and the baseline-then-apply
-- path in tests/smoke/migrations.test.ts must treat the DDL as the no-op it
-- is there.
DROP TABLE IF EXISTS "team_invites" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "team_members" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "teams" CASCADE;

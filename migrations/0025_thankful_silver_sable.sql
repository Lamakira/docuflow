-- IdentityProvider subject id on `users` (#108, ADR-0007, ADR-0017). The link a
-- Clerk import writes back, named for the port rather than the vendor. NULL means
-- the User has not been imported; `users.password` stays and keeps serving the
-- current login path. Unique, and Postgres allows multiple NULLs.
--
-- IF NOT EXISTS / duplicate_object: a database built by drizzle-kit push from
-- current shared/schema.ts already has these objects, and the
-- baseline-then-apply path in tests/smoke/migrations.test.ts must treat the
-- DDL as the no-op it is there.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "identity_provider_subject_id" varchar;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "users" ADD CONSTRAINT "users_identity_provider_subject_id_unique" UNIQUE("identity_provider_subject_id");
EXCEPTION
	WHEN duplicate_object THEN NULL;
	WHEN duplicate_table THEN NULL;
END $$;

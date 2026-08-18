-- Occurrence-keyed Jobs and the lease the Worker scheduler holds (#83, ADR-0013).
-- Recurring due-reminder ticks expand into one Job per reminder; the unique
-- occurrence key makes a second tick a no-op rather than a duplicate. The lease
-- is how one Worker, not two, runs that tick. Workspace id stays unused.
--
-- `IF NOT EXISTS` throughout: a database built by `drizzle-kit push` from
-- current `shared/schema.ts` already has these objects.
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "occurrence_key" varchar(255);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_jobs_occurrence" ON "jobs" USING btree ("occurrence_key");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scheduler_leases" (
	"name" varchar PRIMARY KEY NOT NULL,
	"holder" varchar NOT NULL,
	"expires_at" timestamp NOT NULL
);

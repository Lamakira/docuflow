-- Jobs port (#82, ADR-0013): the queue the Worker will claim from, and the
-- Dead Letter table exhausted Jobs move into. `workspace_id` is nullable with
-- no foreign key — Phase 4 fills it, and seeding a Workspace here would pull
-- that phase forward. Replay of a Dead Letter is a later ticket; this migration
-- only stores the provenance.
--
-- `IF NOT EXISTS` throughout, as on `0003` and `0004`: a database built by
-- `drizzle-kit push` from current `shared/schema.ts` already has these objects,
-- and the baseline-then-apply path in `tests/smoke/migrations.test.ts` must
-- treat this migration as the no-op it is there.
CREATE TABLE IF NOT EXISTS "dead_letters" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" varchar NOT NULL,
	"type" varchar(255) NOT NULL,
	"payload" jsonb NOT NULL,
	"workspace_id" varchar,
	"concurrency_class" varchar(32) NOT NULL,
	"attempts" integer NOT NULL,
	"max_attempts" integer NOT NULL,
	"backoff_ms" integer NOT NULL,
	"timeout_ms" integer NOT NULL,
	"last_error" text NOT NULL,
	"claimed_by" varchar,
	"enqueued_at" timestamp NOT NULL,
	"failed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "jobs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" varchar(255) NOT NULL,
	"payload" jsonb NOT NULL,
	"workspace_id" varchar,
	"concurrency_class" varchar(32) NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer NOT NULL,
	"backoff_ms" integer NOT NULL,
	"timeout_ms" integer NOT NULL,
	"available_at" timestamp DEFAULT now() NOT NULL,
	"claimed_at" timestamp,
	"claim_expires_at" timestamp,
	"claimed_by" varchar,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_dead_letters_job" ON "dead_letters" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_jobs_claimable" ON "jobs" USING btree ("available_at","created_at");

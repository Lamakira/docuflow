-- Cutover: create `project_daily_updates` on the v1 production database.
--
-- Why: the 2026-10-26 rehearsal on the real v1 export (Lamakira/docuflow#355)
-- measured v1 against a database built from 0000-0002. v1 equals
-- 0000_fair_amazoness exactly except that `project_daily_updates` does not
-- exist at all: no table, none of its foreign keys or indexes. 0001 and 0002
-- are not applied either. So neither `--baseline 0002_slimy_whirlwind` nor
-- `--baseline 0000_fair_amazoness` is correct until the table is there.
--
-- What: exactly the `project_daily_updates` statements of 0000, copied
-- verbatim (a test keeps the two from drifting). Not a journal migration: the
-- runner only applies files listed in meta/_journal.json, so this is never run
-- by `db:migrate`, the same as `legacy/`.
--
-- When: once, before `npm run db:migrate -- --baseline 0000_fair_amazoness`,
-- on the restored copy of the v1 production export and on no other database.
-- Never on v1 itself: v1 stays untouched as the rollback (ADR-0018). A
-- database that already has the table would fail on the first statement.
--
-- Why not a journal migration: every environment built from the journal
-- already has this table through 0000, so a migration that creates it would
-- fail there or need IF NOT EXISTS to do nothing. Like `--baseline`, it corrects
-- one database's history, not the schema.
--
-- Transaction: wrapped in BEGIN/COMMIT so a failure part-way leaves no
-- half-built table to clean up by hand; run it with `psql -v ON_ERROR_STOP=1`.
BEGIN;

CREATE TABLE "project_daily_updates" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"crm_project_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"update_date" timestamp DEFAULT now() NOT NULL,
	"status" varchar(50) NOT NULL,
	"what_happened" text,
	"what_was_done" text,
	"needs_client_update" boolean DEFAULT false NOT NULL,
	"needs_client_submission" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

ALTER TABLE "project_daily_updates" ADD CONSTRAINT "project_daily_updates_crm_project_id_crm_projects_id_fk" FOREIGN KEY ("crm_project_id") REFERENCES "public"."crm_projects"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "project_daily_updates" ADD CONSTRAINT "project_daily_updates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
CREATE INDEX "idx_daily_updates_project" ON "project_daily_updates" USING btree ("crm_project_id");
CREATE INDEX "idx_daily_updates_user" ON "project_daily_updates" USING btree ("user_id");
CREATE INDEX "idx_daily_updates_date" ON "project_daily_updates" USING btree ("update_date");
CREATE UNIQUE INDEX "idx_daily_updates_unique" ON "project_daily_updates" USING btree ("crm_project_id","user_id","update_date");

COMMIT;

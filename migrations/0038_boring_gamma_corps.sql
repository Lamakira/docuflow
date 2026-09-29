-- The Plan chosen on the marketing site (#299). The pricing page links to
-- `/signup?plan=<name>`, and the first Workspace's billing pin keeps that choice
-- so Billing can offer it first. An intent, not an Entitlement: the Workspace
-- still starts on the Trial.
--
-- IF NOT EXISTS: a database built by drizzle-kit push from current
-- shared/schema.ts already has these columns, and the baseline-then-apply path
-- in tests/smoke/migrations.test.ts must treat the DDL as the no-op it is there.
ALTER TABLE "workspace_billing" ADD COLUMN IF NOT EXISTS "intended_plan_key" varchar(32);--> statement-breakpoint
ALTER TABLE "workspace_billing" ADD COLUMN IF NOT EXISTS "intended_billing_interval" varchar(16);

-- Billing state machine columns (#140, ADR-0010). Trialing stores a DocuFlow-
-- owned trial end; cancel-at-period-end stores the flag and period end.
-- Stripe webhooks are not this migration.
--
-- IF NOT EXISTS: a database built by drizzle-kit push from current
-- shared/schema.ts already has these columns, and the baseline-then-apply
-- path in tests/smoke/migrations.test.ts must treat the DDL as the no-op it is.
ALTER TABLE "workspace_billing" ADD COLUMN IF NOT EXISTS "trial_ends_at" timestamp;--> statement-breakpoint
ALTER TABLE "workspace_billing" ADD COLUMN IF NOT EXISTS "period_ends_at" timestamp;--> statement-breakpoint
ALTER TABLE "workspace_billing" ADD COLUMN IF NOT EXISTS "cancel_at_period_end" boolean DEFAULT false NOT NULL;

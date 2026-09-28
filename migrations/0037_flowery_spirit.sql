-- Plans and Entitlements matching the pricing page (#299). The billing pin
-- records the Subscription's billing interval (`monthly` or `annual`, read from
-- the Stripe Price), and Entitlement overrides gain sales-led feature grants.
-- Plan keys stay text: registry version 2 Plans need no DDL, and no Workspace is
-- moved to them here — `scripts/assign-plan.ts` does that, audited.
--
-- IF NOT EXISTS: a database built by drizzle-kit push from current
-- shared/schema.ts already has these columns, and the baseline-then-apply path
-- in tests/smoke/migrations.test.ts must treat the DDL as the no-op it is there.
ALTER TABLE "workspace_billing" ADD COLUMN IF NOT EXISTS "billing_interval" varchar(16);--> statement-breakpoint
ALTER TABLE "workspace_entitlement_overrides" ADD COLUMN IF NOT EXISTS "features" jsonb;

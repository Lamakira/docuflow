-- Delivery Preference on Membership (#210). Per User × Workspace (CONTEXT.md).
-- IF NOT EXISTS: a database built by drizzle-kit push from current
-- shared/schema.ts already has this column, and the baseline-then-apply
-- path in tests/smoke/migrations.test.ts must treat the DDL as the no-op it is.
ALTER TABLE "memberships" ADD COLUMN IF NOT EXISTS "delivery_preferences" jsonb;
-- Pending seat decrease for period-end apply (#144, ADR-0008). Purchased
-- capacity stays until period end; this column holds the decided quantity.
--
-- IF NOT EXISTS: a database built by drizzle-kit push from current
-- shared/schema.ts already has the column.
ALTER TABLE "workspace_billing" ADD COLUMN IF NOT EXISTS "pending_seat_quantity" integer;

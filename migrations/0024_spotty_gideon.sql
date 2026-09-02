-- Pending Checkout Session id so webhook ingest can route checkout.session.completed
-- without re-fetching the provider (#144, ADR-0013). Cleared when the projection Job
-- applies. Unique; Postgres allows multiple NULLs.
--
-- IF NOT EXISTS: a database built by drizzle-kit push from current shared/schema.ts
-- already has these objects.
ALTER TABLE "workspace_billing" ADD COLUMN IF NOT EXISTS "pending_checkout_session_id" varchar;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_workspace_billing_pending_checkout" ON "workspace_billing" USING btree ("pending_checkout_session_id");

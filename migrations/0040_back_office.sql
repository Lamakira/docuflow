-- Back office (#314): Subscription price on the pin, payment and dispute
-- records, and Support Requests with their answers and notes.
--
-- Every new table is Workspace-scoped with the same row-level security policy
-- as 0039. IF NOT EXISTS / duplicate_object: a database built by
-- drizzle-kit push from current shared/schema.ts already has these objects.
CREATE TABLE IF NOT EXISTS "billing_payments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" varchar NOT NULL,
	"provider_event_id" varchar NOT NULL,
	"provider_invoice_id" varchar NOT NULL,
	"outcome" varchar(16) NOT NULL,
	"amount_minor" integer,
	"currency" varchar(3),
	"occurred_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "billing_payments_provider_event_id_unique" UNIQUE("provider_event_id"),
	CONSTRAINT "idx_billing_payments_id_workspace" UNIQUE("id","workspace_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payment_disputes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" varchar NOT NULL,
	"provider_dispute_id" varchar NOT NULL,
	"provider_charge_id" varchar,
	"amount_minor" integer NOT NULL,
	"currency" varchar(3) NOT NULL,
	"reason" varchar(64) NOT NULL,
	"status" varchar(64) NOT NULL,
	"opened_at" timestamp NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "payment_disputes_provider_dispute_id_unique" UNIQUE("provider_dispute_id"),
	CONSTRAINT "idx_payment_disputes_id_workspace" UNIQUE("id","workspace_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "support_request_entries" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" varchar NOT NULL,
	"support_request_id" varchar NOT NULL,
	"kind" varchar(16) NOT NULL,
	"body" text NOT NULL,
	"platform_staff_id" varchar,
	"emailed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "support_requests" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"category" varchar(16) NOT NULL,
	"message" text NOT NULL,
	"status" varchar(16) DEFAULT 'open' NOT NULL,
	"assigned_staff_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "idx_support_requests_id_workspace" UNIQUE("id","workspace_id")
);
--> statement-breakpoint
ALTER TABLE "workspace_billing" ADD COLUMN IF NOT EXISTS "unit_amount_minor" integer;
--> statement-breakpoint
ALTER TABLE "workspace_billing" ADD COLUMN IF NOT EXISTS "currency" varchar(3);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "billing_payments" ADD CONSTRAINT "billing_payments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "payment_disputes" ADD CONSTRAINT "payment_disputes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "support_request_entries" ADD CONSTRAINT "support_request_entries_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "support_request_entries" ADD CONSTRAINT "support_request_entries_platform_staff_id_platform_staff_id_fk" FOREIGN KEY ("platform_staff_id") REFERENCES "public"."platform_staff"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "support_request_entries" ADD CONSTRAINT "support_request_entries_request_workspace_fk" FOREIGN KEY ("support_request_id","workspace_id") REFERENCES "public"."support_requests"("id","workspace_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "support_requests" ADD CONSTRAINT "support_requests_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "support_requests" ADD CONSTRAINT "support_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "support_requests" ADD CONSTRAINT "support_requests_assigned_staff_id_platform_staff_id_fk" FOREIGN KEY ("assigned_staff_id") REFERENCES "public"."platform_staff"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_billing_payments_workspace_occurred" ON "billing_payments" USING btree ("workspace_id","occurred_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_payment_disputes_workspace_opened" ON "payment_disputes" USING btree ("workspace_id","opened_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_support_request_entries_request" ON "support_request_entries" USING btree ("workspace_id","support_request_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_support_requests_workspace_created" ON "support_requests" USING btree ("workspace_id","created_at");
--> statement-breakpoint
ALTER TABLE "billing_payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS workspace_isolation ON "billing_payments";--> statement-breakpoint
CREATE POLICY workspace_isolation ON "billing_payments"
	FOR ALL
	TO PUBLIC
	USING (workspace_id = current_setting('app.workspace_id', true))
	WITH CHECK (workspace_id = current_setting('app.workspace_id', true));--> statement-breakpoint
ALTER TABLE "payment_disputes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS workspace_isolation ON "payment_disputes";--> statement-breakpoint
CREATE POLICY workspace_isolation ON "payment_disputes"
	FOR ALL
	TO PUBLIC
	USING (workspace_id = current_setting('app.workspace_id', true))
	WITH CHECK (workspace_id = current_setting('app.workspace_id', true));--> statement-breakpoint
ALTER TABLE "support_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS workspace_isolation ON "support_requests";--> statement-breakpoint
CREATE POLICY workspace_isolation ON "support_requests"
	FOR ALL
	TO PUBLIC
	USING (workspace_id = current_setting('app.workspace_id', true))
	WITH CHECK (workspace_id = current_setting('app.workspace_id', true));--> statement-breakpoint
ALTER TABLE "support_request_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS workspace_isolation ON "support_request_entries";--> statement-breakpoint
CREATE POLICY workspace_isolation ON "support_request_entries"
	FOR ALL
	TO PUBLIC
	USING (workspace_id = current_setting('app.workspace_id', true))
	WITH CHECK (workspace_id = current_setting('app.workspace_id', true));

ALTER TABLE "project_daily_updates" ADD COLUMN "next_steps" text;--> statement-breakpoint
ALTER TABLE "project_daily_updates" ADD COLUMN "blockage_type" varchar(20);--> statement-breakpoint
ALTER TABLE "project_daily_updates" ADD COLUMN "waiting_on_client" boolean DEFAULT false NOT NULL;
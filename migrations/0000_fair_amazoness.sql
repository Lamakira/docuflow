CREATE TABLE "agent_activity_events" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"time_entry_id" varchar,
	"batch_id" varchar NOT NULL,
	"event_type" varchar(50) NOT NULL,
	"timestamp" timestamp NOT NULL,
	"data" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "agent_pairing_codes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"code" varchar(10) NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "agent_pairing_codes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "agent_processed_batches" (
	"batch_id" varchar PRIMARY KEY NOT NULL,
	"device_id" varchar NOT NULL,
	"event_count" integer DEFAULT 0 NOT NULL,
	"processed_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "audio_recordings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" varchar,
	"company_document_id" varchar,
	"owner_id" varchar NOT NULL,
	"audio_url" varchar(2000) NOT NULL,
	"transcript" text,
	"transcript_status" varchar(50) DEFAULT 'pending' NOT NULL,
	"duration" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "company_document_embeddings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_document_id" varchar NOT NULL,
	"folder_id" varchar,
	"chunk_index" integer DEFAULT 0 NOT NULL,
	"chunk_text" text NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "company_document_folders" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"created_by_id" varchar NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "company_documents" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(500) NOT NULL,
	"description" text,
	"content" jsonb,
	"file_name" varchar(500),
	"file_size" integer,
	"mime_type" varchar(100),
	"storage_path" varchar(1000),
	"folder_id" varchar,
	"uploaded_by_id" varchar NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "crm_clients" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"company" varchar(255),
	"email" varchar(255),
	"phone" varchar(50),
	"phone_format" varchar(20) DEFAULT 'us',
	"notes" text,
	"status" varchar(50) DEFAULT 'lead' NOT NULL,
	"source" varchar(50),
	"fiverr_username" varchar(100),
	"owner_id" varchar NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "crm_contacts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" varchar NOT NULL,
	"name" varchar(255) NOT NULL,
	"role" varchar(100),
	"email" varchar(255),
	"phone" varchar(50),
	"is_primary" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "crm_custom_field_values" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"crm_project_id" varchar NOT NULL,
	"field_id" varchar NOT NULL,
	"value" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "crm_module_fields" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"module_id" varchar NOT NULL,
	"name" varchar(100) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"field_type" varchar(50) DEFAULT 'text' NOT NULL,
	"description" text,
	"placeholder" varchar(255),
	"default_value" text,
	"options" jsonb,
	"is_required" integer DEFAULT 0 NOT NULL,
	"is_system" integer DEFAULT 0 NOT NULL,
	"is_enabled" integer DEFAULT 1 NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "crm_modules" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"description" text,
	"icon" varchar(50),
	"is_system" integer DEFAULT 0 NOT NULL,
	"is_enabled" integer DEFAULT 1 NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "crm_modules_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "crm_project_notes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"crm_project_id" varchar NOT NULL,
	"content" text NOT NULL,
	"created_by_id" varchar NOT NULL,
	"mentioned_user_ids" text[],
	"audio_url" text,
	"audio_transcript" text,
	"transcript_status" varchar(20),
	"audio_recording_id" varchar,
	"attachments" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "crm_project_stage_history" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"crm_project_id" varchar NOT NULL,
	"from_status" varchar(50),
	"to_status" varchar(50) NOT NULL,
	"changed_by_id" varchar NOT NULL,
	"changed_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "crm_project_tags" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"crm_project_id" varchar NOT NULL,
	"tag_id" varchar NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "crm_projects" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"client_id" varchar,
	"status" varchar(50) DEFAULT 'lead' NOT NULL,
	"project_type" varchar(50) DEFAULT 'one_time',
	"assignee_id" varchar,
	"start_date" timestamp,
	"due_date" timestamp,
	"actual_finish_date" timestamp,
	"comments" text,
	"budgeted_hours" integer,
	"budgeted_minutes" integer DEFAULT 0,
	"actual_hours" integer,
	"actual_minutes" integer DEFAULT 0,
	"documentation_enabled" integer DEFAULT 0,
	"is_documentation_only" integer DEFAULT 0,
	"review_started_at" timestamp,
	"total_review_ms" bigint DEFAULT 0,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "crm_tags" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"color" varchar(20) DEFAULT '#6366f1' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "desktop_releases" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" varchar(50) NOT NULL,
	"platform" varchar(20) NOT NULL,
	"filename" varchar(255) NOT NULL,
	"storage_url" text NOT NULL,
	"file_size" bigint,
	"sha256" varchar(64),
	"is_latest" boolean DEFAULT false NOT NULL,
	"published_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"name" varchar(255) NOT NULL,
	"os" varchar(100),
	"client_version" varchar(50),
	"device_token_hash" varchar(64) NOT NULL,
	"last_seen_at" timestamp,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "document_embeddings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" varchar NOT NULL,
	"project_id" varchar NOT NULL,
	"owner_id" varchar NOT NULL,
	"chunk_index" integer DEFAULT 0 NOT NULL,
	"chunk_text" text NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(500) DEFAULT 'Untitled' NOT NULL,
	"content" jsonb,
	"icon" varchar(50),
	"cover_image" varchar,
	"project_id" varchar NOT NULL,
	"parent_id" varchar,
	"position" integer DEFAULT 0 NOT NULL,
	"created_by_id" varchar,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"type" varchar(50) DEFAULT 'mention' NOT NULL,
	"note_id" varchar,
	"crm_project_id" varchar,
	"from_user_id" varchar,
	"message" text,
	"is_read" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "org_settings" (
	"id" varchar PRIMARY KEY DEFAULT 'default' NOT NULL,
	"screenshot_policy" jsonb,
	"allowed_timezones" jsonb,
	"help_center_screenshots" jsonb,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE "project_members" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"crm_project_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"icon" varchar(50),
	"owner_id" varchar NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "reminders" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"crm_project_id" varchar NOT NULL,
	"task_id" varchar,
	"title" varchar(255) NOT NULL,
	"note" text,
	"due_at" timestamp NOT NULL,
	"status" varchar(20) DEFAULT 'upcoming' NOT NULL,
	"notified" integer DEFAULT 0 NOT NULL,
	"notified_in_app" integer DEFAULT 0 NOT NULL,
	"email_sent" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"sid" varchar PRIMARY KEY NOT NULL,
	"sess" jsonb NOT NULL,
	"expire" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"crm_project_id" varchar NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"status" varchar(20) DEFAULT 'open' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "team_invites" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" varchar NOT NULL,
	"code" varchar(64) NOT NULL,
	"created_by_id" varchar NOT NULL,
	"expires_at" timestamp,
	"max_uses" integer,
	"use_count" integer DEFAULT 0 NOT NULL,
	"is_active" varchar(5) DEFAULT 'true' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "team_invites_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "team_members" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"role" varchar(20) DEFAULT 'member' NOT NULL,
	"joined_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"owner_id" varchar NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "time_entries" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"crm_project_id" varchar NOT NULL,
	"task_id" varchar,
	"description" text,
	"start_time" timestamp NOT NULL,
	"end_time" timestamp,
	"duration" integer DEFAULT 0,
	"idle_time" integer DEFAULT 0,
	"status" varchar(20) DEFAULT 'running' NOT NULL,
	"last_activity_at" timestamp,
	"client_command_id" varchar(64),
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "time_entries_client_command_id_unique" UNIQUE("client_command_id")
);
--> statement-breakpoint
CREATE TABLE "time_entry_screenshots" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"time_entry_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"crm_project_id" varchar NOT NULL,
	"storage_key" varchar(500) NOT NULL,
	"content_hash" varchar(64),
	"keyboard_activity_percent" integer,
	"mouse_activity_percent" integer,
	"keyboard_count" integer,
	"mouse_count" integer,
	"captured_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"deleted_at" timestamp,
	"deleted_by" varchar,
	"delete_reason" varchar(500)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar NOT NULL,
	"password" varchar(255) NOT NULL,
	"first_name" varchar,
	"last_name" varchar,
	"profile_image_url" varchar,
	"role" varchar(20) DEFAULT 'user' NOT NULL,
	"is_main_admin" integer DEFAULT 0 NOT NULL,
	"hours_per_day" integer DEFAULT 8 NOT NULL,
	"last_generated_password" varchar(255),
	"last_login_at" timestamp,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "video_transcripts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"video_url" varchar(2000) NOT NULL,
	"video_id" varchar(255) NOT NULL,
	"provider" varchar(50) NOT NULL,
	"document_id" varchar NOT NULL,
	"project_id" varchar NOT NULL,
	"owner_id" varchar NOT NULL,
	"transcript" text,
	"status" varchar(50) DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "agent_activity_events" ADD CONSTRAINT "agent_activity_events_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_activity_events" ADD CONSTRAINT "agent_activity_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_activity_events" ADD CONSTRAINT "agent_activity_events_time_entry_id_time_entries_id_fk" FOREIGN KEY ("time_entry_id") REFERENCES "public"."time_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_pairing_codes" ADD CONSTRAINT "agent_pairing_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_processed_batches" ADD CONSTRAINT "agent_processed_batches_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audio_recordings" ADD CONSTRAINT "audio_recordings_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audio_recordings" ADD CONSTRAINT "audio_recordings_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_document_embeddings" ADD CONSTRAINT "company_document_embeddings_company_document_id_company_documents_id_fk" FOREIGN KEY ("company_document_id") REFERENCES "public"."company_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_document_embeddings" ADD CONSTRAINT "company_document_embeddings_folder_id_company_document_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."company_document_folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_document_folders" ADD CONSTRAINT "company_document_folders_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_documents" ADD CONSTRAINT "company_documents_folder_id_company_document_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."company_document_folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_documents" ADD CONSTRAINT "company_documents_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_clients" ADD CONSTRAINT "crm_clients_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_contacts" ADD CONSTRAINT "crm_contacts_client_id_crm_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."crm_clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_custom_field_values" ADD CONSTRAINT "crm_custom_field_values_crm_project_id_crm_projects_id_fk" FOREIGN KEY ("crm_project_id") REFERENCES "public"."crm_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_custom_field_values" ADD CONSTRAINT "crm_custom_field_values_field_id_crm_module_fields_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."crm_module_fields"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_module_fields" ADD CONSTRAINT "crm_module_fields_module_id_crm_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."crm_modules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_project_notes" ADD CONSTRAINT "crm_project_notes_crm_project_id_crm_projects_id_fk" FOREIGN KEY ("crm_project_id") REFERENCES "public"."crm_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_project_notes" ADD CONSTRAINT "crm_project_notes_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_project_stage_history" ADD CONSTRAINT "crm_project_stage_history_crm_project_id_crm_projects_id_fk" FOREIGN KEY ("crm_project_id") REFERENCES "public"."crm_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_project_stage_history" ADD CONSTRAINT "crm_project_stage_history_changed_by_id_users_id_fk" FOREIGN KEY ("changed_by_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_project_tags" ADD CONSTRAINT "crm_project_tags_crm_project_id_crm_projects_id_fk" FOREIGN KEY ("crm_project_id") REFERENCES "public"."crm_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_project_tags" ADD CONSTRAINT "crm_project_tags_tag_id_crm_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."crm_tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_projects" ADD CONSTRAINT "crm_projects_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_projects" ADD CONSTRAINT "crm_projects_client_id_crm_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."crm_clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_projects" ADD CONSTRAINT "crm_projects_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_embeddings" ADD CONSTRAINT "document_embeddings_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_embeddings" ADD CONSTRAINT "document_embeddings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_embeddings" ADD CONSTRAINT "document_embeddings_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_note_id_crm_project_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."crm_project_notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_crm_project_id_crm_projects_id_fk" FOREIGN KEY ("crm_project_id") REFERENCES "public"."crm_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_from_user_id_users_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_daily_updates" ADD CONSTRAINT "project_daily_updates_crm_project_id_crm_projects_id_fk" FOREIGN KEY ("crm_project_id") REFERENCES "public"."crm_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_daily_updates" ADD CONSTRAINT "project_daily_updates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_crm_project_id_crm_projects_id_fk" FOREIGN KEY ("crm_project_id") REFERENCES "public"."crm_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_crm_project_id_crm_projects_id_fk" FOREIGN KEY ("crm_project_id") REFERENCES "public"."crm_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_crm_project_id_crm_projects_id_fk" FOREIGN KEY ("crm_project_id") REFERENCES "public"."crm_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_invites" ADD CONSTRAINT "team_invites_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_invites" ADD CONSTRAINT "team_invites_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_crm_project_id_crm_projects_id_fk" FOREIGN KEY ("crm_project_id") REFERENCES "public"."crm_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entry_screenshots" ADD CONSTRAINT "time_entry_screenshots_time_entry_id_time_entries_id_fk" FOREIGN KEY ("time_entry_id") REFERENCES "public"."time_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entry_screenshots" ADD CONSTRAINT "time_entry_screenshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entry_screenshots" ADD CONSTRAINT "time_entry_screenshots_crm_project_id_crm_projects_id_fk" FOREIGN KEY ("crm_project_id") REFERENCES "public"."crm_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entry_screenshots" ADD CONSTRAINT "time_entry_screenshots_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_transcripts" ADD CONSTRAINT "video_transcripts_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_transcripts" ADD CONSTRAINT "video_transcripts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_transcripts" ADD CONSTRAINT "video_transcripts_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_agent_events_device" ON "agent_activity_events" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "idx_agent_events_user_time" ON "agent_activity_events" USING btree ("user_id","timestamp");--> statement-breakpoint
CREATE INDEX "idx_agent_events_batch" ON "agent_activity_events" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "idx_pairing_code" ON "agent_pairing_codes" USING btree ("code");--> statement-breakpoint
CREATE INDEX "idx_processed_batches_device" ON "agent_processed_batches" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "idx_processed_batches_time" ON "agent_processed_batches" USING btree ("processed_at");--> statement-breakpoint
CREATE INDEX "idx_audio_recordings_document" ON "audio_recordings" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "idx_audio_recordings_company_document" ON "audio_recordings" USING btree ("company_document_id");--> statement-breakpoint
CREATE INDEX "idx_audio_recordings_owner" ON "audio_recordings" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "idx_company_embeddings_document" ON "company_document_embeddings" USING btree ("company_document_id");--> statement-breakpoint
CREATE INDEX "idx_company_embeddings_folder" ON "company_document_embeddings" USING btree ("folder_id");--> statement-breakpoint
CREATE INDEX "idx_company_embeddings_hash" ON "company_document_embeddings" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "idx_company_document_folders_created_by" ON "company_document_folders" USING btree ("created_by_id");--> statement-breakpoint
CREATE INDEX "idx_company_documents_uploaded_by" ON "company_documents" USING btree ("uploaded_by_id");--> statement-breakpoint
CREATE INDEX "idx_company_documents_folder" ON "company_documents" USING btree ("folder_id");--> statement-breakpoint
CREATE INDEX "idx_crm_clients_owner" ON "crm_clients" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "idx_crm_clients_status" ON "crm_clients" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_crm_contacts_client" ON "crm_contacts" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "idx_crm_custom_field_values_project" ON "crm_custom_field_values" USING btree ("crm_project_id");--> statement-breakpoint
CREATE INDEX "idx_crm_custom_field_values_field" ON "crm_custom_field_values" USING btree ("field_id");--> statement-breakpoint
CREATE INDEX "idx_crm_module_fields_module" ON "crm_module_fields" USING btree ("module_id");--> statement-breakpoint
CREATE INDEX "idx_crm_module_fields_slug" ON "crm_module_fields" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "idx_crm_modules_slug" ON "crm_modules" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "idx_crm_modules_enabled" ON "crm_modules" USING btree ("is_enabled");--> statement-breakpoint
CREATE INDEX "idx_crm_project_notes_project" ON "crm_project_notes" USING btree ("crm_project_id");--> statement-breakpoint
CREATE INDEX "idx_crm_project_notes_created_by" ON "crm_project_notes" USING btree ("created_by_id");--> statement-breakpoint
CREATE INDEX "idx_crm_stage_history_project" ON "crm_project_stage_history" USING btree ("crm_project_id");--> statement-breakpoint
CREATE INDEX "idx_crm_stage_history_changed_at" ON "crm_project_stage_history" USING btree ("changed_at");--> statement-breakpoint
CREATE INDEX "idx_crm_project_tags_project" ON "crm_project_tags" USING btree ("crm_project_id");--> statement-breakpoint
CREATE INDEX "idx_crm_project_tags_tag" ON "crm_project_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "idx_crm_projects_project" ON "crm_projects" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_crm_projects_client" ON "crm_projects" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "idx_crm_projects_assignee" ON "crm_projects" USING btree ("assignee_id");--> statement-breakpoint
CREATE INDEX "idx_crm_projects_status" ON "crm_projects" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_crm_projects_doc_only" ON "crm_projects" USING btree ("is_documentation_only");--> statement-breakpoint
CREATE INDEX "idx_crm_tags_name" ON "crm_tags" USING btree ("name");--> statement-breakpoint
CREATE INDEX "idx_desktop_releases_platform_latest" ON "desktop_releases" USING btree ("platform","is_latest");--> statement-breakpoint
CREATE INDEX "idx_devices_user" ON "devices" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_devices_token_hash" ON "devices" USING btree ("device_token_hash");--> statement-breakpoint
CREATE INDEX "idx_embeddings_document" ON "document_embeddings" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "idx_embeddings_project" ON "document_embeddings" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_embeddings_owner" ON "document_embeddings" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "idx_embeddings_hash" ON "document_embeddings" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "IDX_document_project" ON "documents" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "IDX_document_parent" ON "documents" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "IDX_document_created_by" ON "documents" USING btree ("created_by_id");--> statement-breakpoint
CREATE INDEX "idx_notifications_user" ON "notifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_notifications_unread" ON "notifications" USING btree ("user_id","is_read");--> statement-breakpoint
CREATE INDEX "idx_daily_updates_project" ON "project_daily_updates" USING btree ("crm_project_id");--> statement-breakpoint
CREATE INDEX "idx_daily_updates_user" ON "project_daily_updates" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_daily_updates_date" ON "project_daily_updates" USING btree ("update_date");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_daily_updates_unique" ON "project_daily_updates" USING btree ("crm_project_id","user_id","update_date");--> statement-breakpoint
CREATE INDEX "idx_project_members_project" ON "project_members" USING btree ("crm_project_id");--> statement-breakpoint
CREATE INDEX "idx_project_members_user" ON "project_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_project_members_unique" ON "project_members" USING btree ("crm_project_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_reminders_user" ON "reminders" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_reminders_project" ON "reminders" USING btree ("crm_project_id");--> statement-breakpoint
CREATE INDEX "idx_reminders_due" ON "reminders" USING btree ("due_at","notified");--> statement-breakpoint
CREATE INDEX "IDX_session_expire" ON "sessions" USING btree ("expire");--> statement-breakpoint
CREATE INDEX "idx_tasks_crm_project" ON "tasks" USING btree ("crm_project_id");--> statement-breakpoint
CREATE INDEX "idx_tasks_status" ON "tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_team_invites_team" ON "team_invites" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "idx_team_invites_code" ON "team_invites" USING btree ("code");--> statement-breakpoint
CREATE INDEX "idx_team_members_team" ON "team_members" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "idx_team_members_user" ON "team_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_time_entries_user" ON "time_entries" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_time_entries_crm_project" ON "time_entries" USING btree ("crm_project_id");--> statement-breakpoint
CREATE INDEX "idx_time_entries_status" ON "time_entries" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_time_entries_start" ON "time_entries" USING btree ("start_time");--> statement-breakpoint
CREATE INDEX "idx_screenshots_time_entry" ON "time_entry_screenshots" USING btree ("time_entry_id");--> statement-breakpoint
CREATE INDEX "idx_screenshots_user" ON "time_entry_screenshots" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_screenshots_project" ON "time_entry_screenshots" USING btree ("crm_project_id");--> statement-breakpoint
CREATE INDEX "idx_screenshots_captured" ON "time_entry_screenshots" USING btree ("captured_at");--> statement-breakpoint
CREATE INDEX "idx_screenshots_deleted" ON "time_entry_screenshots" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "idx_video_transcripts_document" ON "video_transcripts" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "idx_video_transcripts_video_id" ON "video_transcripts" USING btree ("video_id");--> statement-breakpoint
CREATE INDEX "idx_video_transcripts_owner" ON "video_transcripts" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "idx_video_transcripts_status" ON "video_transcripts" USING btree ("status");
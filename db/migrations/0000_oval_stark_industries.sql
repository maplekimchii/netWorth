CREATE TYPE "public"."app_status" AS ENUM('planned', 'applied', 'interview', 'offer', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."contact_source" AS ENUM('linkedin_csv', 'ai_search', 'paste', 'import');--> statement-breakpoint
CREATE TYPE "public"."contact_status" AS ENUM('to_contact', 'drafted', 'sent', 'replied', 'call', 'done', 'dead');--> statement-breakpoint
CREATE TYPE "public"."job_item_status" AS ENUM('pending', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('running', 'done', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."message_kind" AS ENUM('initial', 'followup');--> statement-breakpoint
CREATE TYPE "public"."message_state" AS ENUM('app_draft', 'outlook_draft', 'sent');--> statement-breakpoint
CREATE TABLE "applications" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"role" text NOT NULL,
	"url" text DEFAULT '' NOT NULL,
	"status" "app_status" DEFAULT 'planned' NOT NULL,
	"applied_date" date,
	"referrer_contact_id" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "column_mappings" (
	"signature" text PRIMARY KEY NOT NULL,
	"mapping" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"domain" text DEFAULT '' NOT NULL,
	"industry" text DEFAULT '' NOT NULL,
	"priority" integer DEFAULT 2 NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"news" text DEFAULT '' NOT NULL,
	"news_updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"company_id" integer,
	"title" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"linkedin_url" text DEFAULT '' NOT NULL,
	"source" "contact_source" NOT NULL,
	"how_connected" text DEFAULT '' NOT NULL,
	"status" "contact_status" DEFAULT 'to_contact' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"next_followup_date" date,
	"followup_count" integer DEFAULT 0 NOT NULL,
	"team" text DEFAULT '' NOT NULL,
	"school" text DEFAULT '' NOT NULL,
	"program" text DEFAULT '' NOT NULL,
	"grad_year" integer,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" "message_kind" NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "graph_views" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"levels" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" integer NOT NULL,
	"contact_id" integer NOT NULL,
	"status" "job_item_status" DEFAULT 'pending' NOT NULL,
	"error" text,
	"message_id" integer
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"instruction" text NOT NULL,
	"template_id" integer,
	"status" "job_status" DEFAULT 'running' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"contact_id" integer NOT NULL,
	"kind" "message_kind" NOT NULL,
	"state" "message_state" DEFAULT 'app_draft' NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"outlook_message_id" text,
	"outlook_conversation_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"replied_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "outlook_tokens" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text NOT NULL,
	"expires_at" integer NOT NULL,
	"scope" text DEFAULT '' NOT NULL,
	CONSTRAINT "outlook_tokens_single_row" CHECK ("outlook_tokens"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "profile" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"program" text DEFAULT '' NOT NULL,
	"resume_text" text DEFAULT '' NOT NULL,
	"story" text DEFAULT '' NOT NULL,
	"target_roles" text DEFAULT '' NOT NULL,
	"voice_samples" text DEFAULT '' NOT NULL,
	"followup_days" integer DEFAULT 5 NOT NULL,
	CONSTRAINT "profile_single_row" CHECK ("profile"."id" = 1)
);
--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_referrer_contact_id_contacts_id_fk" FOREIGN KEY ("referrer_contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_items" ADD CONSTRAINT "job_items_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_items" ADD CONSTRAINT "job_items_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_items" ADD CONSTRAINT "job_items_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_template_id_email_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."email_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "companies_name_ci" ON "companies" USING btree (lower("name"));
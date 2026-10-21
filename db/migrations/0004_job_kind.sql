CREATE TYPE "public"."job_kind" AS ENUM('draft', 'enrich');--> statement-breakpoint
ALTER TABLE "jobs" ALTER COLUMN "instruction" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "kind" "job_kind" DEFAULT 'draft' NOT NULL;
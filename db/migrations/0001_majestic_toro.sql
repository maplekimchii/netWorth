ALTER TABLE "outlook_tokens" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "outlook_tokens" CASCADE;--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "state" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "state" SET DEFAULT 'draft'::text;--> statement-breakpoint
DROP TYPE "public"."message_state";--> statement-breakpoint
CREATE TYPE "public"."message_state" AS ENUM('draft', 'sent');--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "state" SET DEFAULT 'draft'::"public"."message_state";--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "state" SET DATA TYPE "public"."message_state" USING "state"::"public"."message_state";--> statement-breakpoint
ALTER TABLE "messages" DROP COLUMN "outlook_message_id";--> statement-breakpoint
ALTER TABLE "messages" DROP COLUMN "outlook_conversation_id";
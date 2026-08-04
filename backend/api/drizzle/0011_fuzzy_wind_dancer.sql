ALTER TYPE "public"."spend_decision" ADD VALUE 'approval_granted';--> statement-breakpoint
ALTER TYPE "public"."spend_decision" ADD VALUE 'approval_denied';--> statement-breakpoint
ALTER TABLE "spend_events" ADD COLUMN "prompt" text;
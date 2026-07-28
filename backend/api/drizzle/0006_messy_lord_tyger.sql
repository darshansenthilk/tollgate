ALTER TABLE "spend_events" ADD COLUMN "model" text;--> statement-breakpoint
ALTER TABLE "spend_events" ADD COLUMN "prompt_tokens" integer;--> statement-breakpoint
ALTER TABLE "spend_events" ADD COLUMN "completion_tokens" integer;
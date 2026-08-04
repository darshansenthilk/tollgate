CREATE TYPE "public"."tool_approval_status" AS ENUM('pending', 'approved', 'denied');--> statement-breakpoint
ALTER TYPE "public"."spend_decision" ADD VALUE 'denied_tool';--> statement-breakpoint
ALTER TYPE "public"."spend_decision" ADD VALUE 'approval_granted';--> statement-breakpoint
ALTER TYPE "public"."spend_decision" ADD VALUE 'approval_denied';--> statement-breakpoint
CREATE TABLE "tool_approval_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"agent_id" uuid NOT NULL,
	"tool_name" text NOT NULL,
	"status" "tool_approval_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" text
);
--> statement-breakpoint
ALTER TABLE "policies" ADD COLUMN "blocked_tools" text[];--> statement-breakpoint
ALTER TABLE "policies" ADD COLUMN "system_prompt" text;--> statement-breakpoint
ALTER TABLE "policies" ADD COLUMN "tool_definitions" jsonb;--> statement-breakpoint
ALTER TABLE "spend_events" ADD COLUMN "prompt" text;--> statement-breakpoint
ALTER TABLE "tool_approval_requests" ADD CONSTRAINT "tool_approval_requests_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tool_approval_requests_pending_unique" ON "tool_approval_requests" USING btree ("agent_id","tool_name") WHERE "tool_approval_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "spend_events_agent_created_idx" ON "spend_events" USING btree ("agent_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "spend_events_created_idx" ON "spend_events" USING btree ("created_at" DESC NULLS LAST);
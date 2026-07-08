CREATE TYPE "public"."agent_status" AS ENUM('active', 'pending', 'soft_frozen', 'hard_frozen', 'archived');--> statement-breakpoint
CREATE TYPE "public"."budget_window" AS ENUM('daily', 'weekly', 'monthly');--> statement-breakpoint
CREATE TYPE "public"."fail_mode" AS ENUM('fail_closed', 'fail_open_degraded');--> statement-breakpoint
CREATE TYPE "public"."spend_decision" AS ENUM('allowed', 'denied_budget', 'denied_rate', 'denied_endpoint', 'denied_frozen');--> statement-breakpoint
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL,
	"name" text NOT NULL,
	"provider_slug" text NOT NULL,
	"status" "agent_status" DEFAULT 'active' NOT NULL,
	"policy_id" uuid,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agents_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "policies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL,
	"name" text NOT NULL,
	"budget_cents" integer NOT NULL,
	"budget_window" "budget_window" DEFAULT 'monthly' NOT NULL,
	"rate_limit_rpm" integer,
	"endpoint_allowlist" text[],
	"fail_mode" "fail_mode" DEFAULT 'fail_closed' NOT NULL,
	"max_budget_cents" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spend_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"agent_id" uuid NOT NULL,
	"provider_id" text NOT NULL,
	"endpoint" text NOT NULL,
	"method" text NOT NULL,
	"estimated_cost_cents" numeric(14, 6),
	"actual_cost_cents" numeric(14, 6),
	"decision" "spend_decision" NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"latency_ms" integer,
	"upstream_status" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "spend_events_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spend_events" ADD CONSTRAINT "spend_events_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;
CREATE TABLE "anthropic_managed_agent_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"agent_id" uuid NOT NULL,
	"org_id" text NOT NULL,
	"anthropic_api_key_id" text NOT NULL,
	"anthropic_workspace_id" text,
	"current_session_id" text,
	"last_polled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "anthropic_managed_agent_links_agent_id_unique" UNIQUE("agent_id")
);
--> statement-breakpoint
CREATE TABLE "salesforce_agentforce_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"agent_id" uuid NOT NULL,
	"org_id" text NOT NULL,
	"salesforce_org_id" text NOT NULL,
	"agentforce_agent_id" text NOT NULL,
	"last_polled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "salesforce_agentforce_links_agent_id_unique" UNIQUE("agent_id")
);
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "host_platform" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "mcp_target_key_id" uuid;--> statement-breakpoint
ALTER TABLE "anthropic_managed_agent_links" ADD CONSTRAINT "anthropic_managed_agent_links_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesforce_agentforce_links" ADD CONSTRAINT "salesforce_agentforce_links_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_mcp_target_key_id_org_upstream_keys_id_fk" FOREIGN KEY ("mcp_target_key_id") REFERENCES "public"."org_upstream_keys"("id") ON DELETE set null ON UPDATE no action;
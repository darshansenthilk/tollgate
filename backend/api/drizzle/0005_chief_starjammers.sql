CREATE TABLE "org_upstream_keys" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"provider_slug" text NOT NULL,
	"encrypted_key" text NOT NULL,
	"iv" text NOT NULL,
	"auth_tag" text NOT NULL,
	"key_hint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "org_upstream_keys_org_provider_unique" ON "org_upstream_keys" USING btree ("org_id","provider_slug");
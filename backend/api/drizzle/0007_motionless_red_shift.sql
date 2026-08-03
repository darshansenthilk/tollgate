DROP INDEX "org_upstream_keys_org_provider_unique";--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "upstream_key_id" uuid;--> statement-breakpoint
ALTER TABLE "org_upstream_keys" ADD COLUMN "label" text DEFAULT 'Default' NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_upstream_key_id_org_upstream_keys_id_fk" FOREIGN KEY ("upstream_key_id") REFERENCES "public"."org_upstream_keys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "org_upstream_keys_org_provider_label_unique" ON "org_upstream_keys" USING btree ("org_id","provider_slug","label");--> statement-breakpoint
-- Backfill: before this migration, an org could have at most one stored key
-- per ADAPTER slug (the old org_provider_unique index). Point each existing
-- agent at that key so BYOK keeps working post-migration without every org
-- having to re-pick a key per agent. agents.provider_slug is the ASSISTANT
-- label ("chatgpt"/"claude"/"gemini"); org_upstream_keys.provider_slug is the
-- ADAPTER slug ("openai"/"claude"/"gemini") — see backend/proxy/src/adapters/
-- registry.ts's assistantAdapterSlugs, the one other place this mapping lives.
UPDATE "agents" AS a
SET "upstream_key_id" = k."id"
FROM "org_upstream_keys" AS k
WHERE k."org_id" = a."org_id"
  AND k."provider_slug" = CASE a."provider_slug"
        WHEN 'chatgpt' THEN 'openai'
        WHEN 'claude' THEN 'claude'
        WHEN 'gemini' THEN 'gemini'
        ELSE a."provider_slug"
      END
  AND a."upstream_key_id" IS NULL;
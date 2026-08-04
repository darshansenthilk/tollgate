-- Scope agents to a dashboard.
--
-- drizzle-kit generated this as a bare `ADD COLUMN "dashboard_id" uuid NOT NULL`,
-- which fails outright on any database that already has agent rows (no default,
-- nothing to put in the column). Hand-expanded into the standard four steps:
-- add nullable, guarantee a destination exists, backfill, then tighten to NOT
-- NULL. The end state is identical to the generated schema, so the drizzle
-- snapshot still describes this file's result exactly.
--
-- Every existing agent MUST land in some dashboard. A null dashboard_id would
-- match no dashboard filter, so the agent would disappear from the UI while its
-- token kept working — an invisible agent that can still spend money. That's the
-- one outcome worth writing extra SQL to avoid.

DROP INDEX "agents_org_name_unique_when_not_archived";--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "dashboard_id" uuid;--> statement-breakpoint

-- An org can have agents but no dashboard at all: dashboards shipped after
-- agents did, and nothing has ever auto-provisioned one (a deliberate product
-- decision — new accounts start on an empty slate and create their own). Those
-- orgs have no destination to backfill into, so give them exactly one. This is
-- NOT the auto-provisioning that was rejected for sign-up: it only ever fires
-- for an org that already owns agents, and it never runs again.
INSERT INTO "dashboards" ("id", "org_id", "name")
SELECT gen_random_uuid(), o."org_id", 'My agents'
  FROM (SELECT DISTINCT "org_id" FROM "agents") o
 WHERE NOT EXISTS (
   SELECT 1 FROM "dashboards" d WHERE d."org_id" = o."org_id"
 );--> statement-breakpoint

-- Backfill into the org's OLDEST dashboard. Which dashboard an agent was
-- created "in" was never recorded — that's the bug this migration closes — so
-- there is no true answer to recover, only a deterministic one. Oldest-first
-- matches how the tiles are ordered (created_at ASC), so everything lands in the
-- leftmost tile rather than somewhere arbitrary. The id tiebreak keeps the
-- result stable when two dashboards share a timestamp.
UPDATE "agents" a
   SET "dashboard_id" = (
     SELECT d."id"
       FROM "dashboards" d
      WHERE d."org_id" = a."org_id"
      ORDER BY d."created_at" ASC, d."id" ASC
      LIMIT 1
   )
 WHERE a."dashboard_id" IS NULL;--> statement-breakpoint

ALTER TABLE "agents" ALTER COLUMN "dashboard_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_dashboard_id_dashboards_id_fk" FOREIGN KEY ("dashboard_id") REFERENCES "public"."dashboards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- Was (org_id, name). Per-dashboard is strictly weaker and that IS the feature:
-- two dashboards in one org can each hold a "support-bot". Backfilling every one
-- of an org's agents into a single dashboard can't violate it, because the old
-- org-wide index already guaranteed those names were distinct.
CREATE UNIQUE INDEX "agents_dashboard_name_unique_when_not_archived" ON "agents" USING btree ("dashboard_id","name") WHERE "agents"."status" != 'archived';

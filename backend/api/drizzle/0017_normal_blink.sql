-- HAND-EDITED. drizzle-kit generated the DDL below but none of the data
-- statements, and its ordering could not work: it emitted
-- `ADD COLUMN "role_id" uuid NOT NULL` on two tables that already have rows,
-- with no idea the value has to be derived from a table this same migration
-- creates. Every added column is therefore introduced NULLABLE, backfilled,
-- and only then tightened to NOT NULL.
--
-- Every data statement here is a no-op against an empty database (they all
-- select from tables that would have no rows), so the 0000 -> 0017 replay a
-- fresh clone performs still ends in exactly the state drizzle's own
-- 0017_snapshot.json describes.

-- 1. Roles become rows. UNIQUE (id, dashboard_id) is a real CONSTRAINT rather
--    than a unique index because it is the target of dashboard_members'
--    composite FK below, and Postgres only accepts a constraint there.
CREATE TABLE "dashboard_roles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"dashboard_id" uuid NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dashboard_roles_id_dashboard_unique" UNIQUE("id","dashboard_id")
);
--> statement-breakpoint
ALTER TABLE "dashboard_roles" ADD CONSTRAINT "dashboard_roles_dashboard_id_dashboards_id_fk" FOREIGN KEY ("dashboard_id") REFERENCES "public"."dashboards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Case-insensitive per dashboard: Editor/editor/EDITOR are one name. Created
-- BEFORE the seed so a pre-existing duplicate would fail loudly here rather
-- than after the backfill has already run.
CREATE UNIQUE INDEX "dashboard_roles_dashboard_lower_name_unique" ON "dashboard_roles" USING btree ("dashboard_id",lower("name"));--> statement-breakpoint

-- 2. Seed one default role per dashboard — ARCHIVED ONES INCLUDED, so a
--    manual un-archive can't surface a dashboard with no roles at all (and so
--    the two backfills below can't leave a NULL behind). gen_random_uuid() is
--    core in Postgres 13+; no pgcrypto extension is required.
INSERT INTO "dashboard_roles" ("id", "dashboard_id", "name", "is_default")
SELECT gen_random_uuid(), "id", 'Observer', true FROM "dashboards";--> statement-breakpoint

-- 3. dashboard_members.role (enum) -> role_id (uuid FK).
ALTER TABLE "dashboard_members" ADD COLUMN "role_id" uuid;--> statement-breakpoint
UPDATE "dashboard_members" AS m
SET "role_id" = r."id"
FROM "dashboard_roles" AS r
WHERE r."dashboard_id" = m."dashboard_id" AND r."is_default" = true;--> statement-breakpoint
ALTER TABLE "dashboard_members" ALTER COLUMN "role_id" SET NOT NULL;--> statement-breakpoint
-- Composite, so Postgres makes "member of dashboard A holding a role of
-- dashboard B" unrepresentable. NO ON DELETE ACTION on purpose: NO ACTION is
-- what makes Postgres refuse to delete a role somebody still holds, which is
-- the guarantee behind DELETE /v1/dashboards/:id/roles/:roleId's friendly
-- "N account(s) currently have it" refusal.
ALTER TABLE "dashboard_members" ADD CONSTRAINT "dashboard_members_role_id_dashboard_id_fk" FOREIGN KEY ("role_id","dashboard_id") REFERENCES "public"."dashboard_roles"("id","dashboard_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboard_members" DROP COLUMN "role";--> statement-breakpoint

-- 4. dashboard_role_permissions: (dashboard_id, role) -> role_id. Every
--    surviving row is the Observer row's (0016 deleted the other four roles'),
--    so the same is_default join backfills them, and (role_id, action) is
--    unique wherever (dashboard_id, role, action) was.
ALTER TABLE "dashboard_role_permissions" ADD COLUMN "role_id" uuid;--> statement-breakpoint
UPDATE "dashboard_role_permissions" AS p
SET "role_id" = r."id"
FROM "dashboard_roles" AS r
WHERE r."dashboard_id" = p."dashboard_id" AND r."is_default" = true;--> statement-breakpoint
ALTER TABLE "dashboard_role_permissions" ALTER COLUMN "role_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "dashboard_role_permissions" DROP CONSTRAINT "dashboard_role_permissions_dashboard_id_dashboards_id_fk";--> statement-breakpoint
ALTER TABLE "dashboard_role_permissions" DROP CONSTRAINT "dashboard_role_permissions_dashboard_id_role_action_pk";--> statement-breakpoint
ALTER TABLE "dashboard_role_permissions" ADD CONSTRAINT "dashboard_role_permissions_role_id_action_pk" PRIMARY KEY("role_id","action");--> statement-breakpoint
-- ON DELETE CASCADE here, and deliberately NOT on dashboard_members above.
-- These rows are pure configuration with no audit value, and a role anyone
-- holds can't be deleted at all, so this cascade can only ever sweep the
-- toggles of a role nobody holds.
ALTER TABLE "dashboard_role_permissions" ADD CONSTRAINT "dashboard_role_permissions_role_id_dashboard_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."dashboard_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboard_role_permissions" DROP COLUMN "dashboard_id";--> statement-breakpoint
ALTER TABLE "dashboard_role_permissions" DROP COLUMN "role";--> statement-breakpoint

-- 5. Last, once nothing references it.
DROP TYPE "public"."dashboard_member_role";

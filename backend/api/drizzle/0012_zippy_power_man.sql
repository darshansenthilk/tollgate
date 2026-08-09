CREATE TABLE "dashboard_members" (
	"dashboard_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dashboards" ADD COLUMN "created_by" text;--> statement-breakpoint
ALTER TABLE "dashboard_members" ADD CONSTRAINT "dashboard_members_dashboard_id_dashboards_id_fk" FOREIGN KEY ("dashboard_id") REFERENCES "public"."dashboards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dashboard_members_dashboard_user_unique" ON "dashboard_members" USING btree ("dashboard_id","user_id");--> statement-breakpoint
-- Hand-added, not drizzle-generated: backfill created_by for every dashboard
-- that predates this column. dashboards.org_id is plain text (see schema.ts's
-- decoupling comment), so this reaches across into Better Auth's own "member"
-- table by value, not by FK. Better Auth's Postgres adapter creates that table
-- with quoted camelCase columns (confirmed against the live schema, not
-- guessed) — "organizationId", "userId", "role", "createdAt".
--
-- An org can in principle end up with more than one "owner"-role member (role
-- changes, transferred ownership), so this picks one deterministically —
-- oldest membership wins — the same "no true answer, so pick a reproducible
-- one" reasoning 0010's dashboard_id backfill used for its own tie-break.
UPDATE "dashboards" SET "created_by" = (
	SELECT "member"."userId"
	FROM "member"
	WHERE "member"."organizationId" = "dashboards"."org_id"
		AND "member"."role" = 'owner'
	ORDER BY "member"."createdAt" ASC
	LIMIT 1
) WHERE "created_by" IS NULL;
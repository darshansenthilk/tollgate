DROP INDEX "agents_name_unique_when_not_archived";--> statement-breakpoint
ALTER TABLE "agents" ALTER COLUMN "org_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "agents" ALTER COLUMN "org_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "policies" ALTER COLUMN "org_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "policies" ALTER COLUMN "org_id" DROP DEFAULT;--> statement-breakpoint
CREATE UNIQUE INDEX "agents_org_name_unique_when_not_archived" ON "agents" USING btree ("org_id","name") WHERE "agents"."status" != 'archived';
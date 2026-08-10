--> Hand-added ahead of the generated statements below: drizzle narrows the enum
--> but has no way to know what to do with rows already holding a value it's
--> about to delete, and the USING cast at the end of this file fails outright on
--> one ("invalid input value for enum dashboard_member_role"). Demote surviving
--> members to observer — the schema default, and the only role left — rather
--> than dropping their access entirely; a removed tier never carried any
--> permission of its own, so this loses nothing but the label. Any toggle row
--> for a removed role has no representable value at all once the type narrows,
--> so it goes.
UPDATE "dashboard_members" SET "role" = 'observer' WHERE "role" <> 'observer';--> statement-breakpoint
DELETE FROM "dashboard_role_permissions" WHERE "role" <> 'observer';--> statement-breakpoint
ALTER TABLE "dashboard_members" ALTER COLUMN "role" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "dashboard_members" ALTER COLUMN "role" SET DEFAULT 'observer'::text;--> statement-breakpoint
ALTER TABLE "dashboard_role_permissions" ALTER COLUMN "role" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."dashboard_member_role";--> statement-breakpoint
CREATE TYPE "public"."dashboard_member_role" AS ENUM('observer');--> statement-breakpoint
ALTER TABLE "dashboard_members" ALTER COLUMN "role" SET DEFAULT 'observer'::"public"."dashboard_member_role";--> statement-breakpoint
ALTER TABLE "dashboard_members" ALTER COLUMN "role" SET DATA TYPE "public"."dashboard_member_role" USING "role"::"public"."dashboard_member_role";--> statement-breakpoint
ALTER TABLE "dashboard_role_permissions" ALTER COLUMN "role" SET DATA TYPE "public"."dashboard_member_role" USING "role"::"public"."dashboard_member_role";
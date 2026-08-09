CREATE TYPE "public"."dashboard_permission_action" AS ENUM('createAgent', 'updateAgent', 'freezeAgent', 'unfreezeAgent', 'deleteAgent', 'addDashboardMember');--> statement-breakpoint
CREATE TABLE "dashboard_role_permissions" (
	"dashboard_id" uuid NOT NULL,
	"role" "dashboard_member_role" NOT NULL,
	"action" "dashboard_permission_action" NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	CONSTRAINT "dashboard_role_permissions_dashboard_id_role_action_pk" PRIMARY KEY("dashboard_id","role","action")
);
--> statement-breakpoint
ALTER TABLE "dashboard_role_permissions" ADD CONSTRAINT "dashboard_role_permissions_dashboard_id_dashboards_id_fk" FOREIGN KEY ("dashboard_id") REFERENCES "public"."dashboards"("id") ON DELETE no action ON UPDATE no action;
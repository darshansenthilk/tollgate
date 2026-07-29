import { ActivityLog } from "@/components/activity-log";

/**
 * Standalone route for the activity feed — previously rendered inline at the
 * bottom of /agents. Split out once the nav grew a dedicated "Activity Log"
 * island item. No page-level heading here: ActivityLog supplies its own
 * title via CardTitle, the same convention /agents follows with
 * AgentDashboard's own header.
 */
export default function ActivityPage() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <ActivityLog />
    </main>
  );
}

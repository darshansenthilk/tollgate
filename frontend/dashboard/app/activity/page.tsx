import { ActivityLog } from "@/components/activity-log";

/**
 * Standalone route for the activity feed — previously rendered inline at the
 * bottom of /agents. Split out once the nav grew a dedicated "Activity Log"
 * island item. No page-level heading here: ActivityLog supplies its own
 * title via CardTitle, the same convention /agents follows with
 * AgentDashboard's own header.
 *
 * The pending-approvals queue deliberately lives on /agents rather than here:
 * this page is the record of what already happened, and an approval is an
 * agent stopped mid-task waiting on a human. The operator's DECISION does
 * land in this log, though — see @tollgate/shared SpendDecision.
 */
export default function ActivityPage() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <ActivityLog />
    </main>
  );
}

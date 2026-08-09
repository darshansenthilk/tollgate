"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { AgentStatus, DashboardPermissionAction } from "@tollgate/shared";
import { AgentDashboard } from "@/components/agent-dashboard";
import { ApprovalsPanel } from "@/components/approvals-panel";
import { SuggestionsPanel } from "@/components/suggestions-panel";
import {
  applyCreated,
  applyDeleted,
  applyStatusChange,
  applyUpdated,
} from "@/lib/agent-list-updates";
import {
  addDashboardMember,
  ApiError,
  createAgent,
  deleteAgent,
  freezeAgent,
  getActiveDashboard,
  getDashboardRolePermissions,
  getMyDashboardPermissions,
  listAgents,
  listDashboardMembers,
  listUpstreamKeys,
  removeDashboardMember,
  renameDashboard,
  setDashboardRolePermissions,
  unfreezeAgent,
  updateAgent,
  updateDashboardMemberRole,
  type AgentListItem,
  type CreateAgentInput,
  type CreateAgentResponse,
  type Dashboard,
  type UpdateAgentResponse,
} from "@/lib/api";

const POLL_INTERVAL_MS = 3000;

/** Everything except createAgent, which needs the active dashboard and so is
 *  bound per-render below. Kept module-level so the object identity is stable. */
const DASHBOARD_INDEPENDENT_ACTIONS = {
  updateAgent,
  freezeAgent,
  unfreezeAgent,
  deleteAgent,
  listUpstreamKeys,
};

export default function AgentsPage() {
  const [agents, setAgents] = useState<AgentListItem[] | null>(null);
  // undefined until the first lookup lands, so a page load doesn't flash the
  // "create a dashboard first" empty state at someone who already has one.
  const [activeDashboard, setActiveDashboard] = useState<Dashboard | null | undefined>(
    undefined,
  );
  const [error, setError] = useState<string | null>(null);
  // undefined (not yet fetched) reads as "unrestricted" below, same fail-open
  // stance AgentDashboard's own `myPermissions` doc comment explains — the api
  // is the actual security boundary, this is only ever a UI nicety.
  const [myPermissions, setMyPermissions] = useState<
    Record<DashboardPermissionAction, boolean> | undefined
  >(undefined);

  const refresh = useCallback(async (dashboardId: string) => {
    try {
      const data = await listAgents(dashboardId);
      // Successive polls are identical most of the time. Swapping in a fresh
      // array every 3s re-renders the whole dashboard for nothing, and when
      // that lands mid-animation (opening the sidebar or the create dialog)
      // it shows up as a frame hitch. Keeping the previous reference when the
      // payload is unchanged lets React bail out of the render entirely.
      setAgents((prev) =>
        prev !== null && JSON.stringify(prev) === JSON.stringify(data) ? prev : data,
      );
      setError(null);
    } catch (err) {
      // THE GONE-PATH. The active dashboard is resolved once on mount, so a poll
      // 404 is the only signal this page will ever get that it was deleted.
      // Without this branch it renders the stale agent table under the dead
      // dashboard's name, with a red error repainting every 3s, forever — and
      // every row action in that table still reaches the api.
      //
      // Recover by RE-RESOLVING, not by blanking to null. The server has already
      // re-pointed this user's selection at the org's oldest surviving
      // dashboard, so asking again lands on that survivor; null comes back only
      // when the deleted one really was the last, which is exactly when the
      // "No dashboard yet" gate below is the truthful screen.
      if (err instanceof ApiError && err.code === "dashboard_not_found") {
        try {
          setActiveDashboard(await getActiveDashboard());
          setAgents(null);
          // Clear it explicitly: the error renders as a sibling ABOVE the state
          // branch and is otherwise only cleared by a successful poll, so
          // "That dashboard no longer exists." would stay frozen over the
          // survivor's agent table — an error permanently attached to a page
          // that recovered fine.
          setError(null);
        } catch (resolveErr) {
          setError(
            resolveErr instanceof ApiError ? resolveErr.message : "Failed to reach the api",
          );
        }
        return;
      }
      setError(err instanceof ApiError ? err.message : "Failed to reach the api");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let retryId: ReturnType<typeof setTimeout> | undefined;

    async function lookUpActiveDashboard(): Promise<void> {
      try {
        const active = await getActiveDashboard();
        if (cancelled) return;
        setActiveDashboard(active);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        // Don't fall back to the empty state — a failed lookup isn't proof the
        // caller has no dashboard. But don't just stall either: leaving
        // activeDashboard undefined pins the page on "Loading…" with nothing to
        // re-trigger it, since the poll below never starts and neither effect
        // re-runs. Retrying on the poll interval keeps a transient api blip
        // self-healing, the way it was before this gate existed.
        setError(err instanceof ApiError ? err.message : "Failed to reach the api");
        retryId = setTimeout(() => void lookUpActiveDashboard(), POLL_INTERVAL_MS);
      }
    }

    void lookUpActiveDashboard();
    return () => {
      cancelled = true;
      if (retryId !== undefined) clearTimeout(retryId);
    };
  }, []);

  const activeDashboardId = activeDashboard?.id ?? null;

  useEffect(() => {
    if (activeDashboardId === null) return;
    // Drop the previous dashboard's agents before fetching this one's. Without
    // it, switching dashboards renders the old list under the new dashboard's
    // name for one poll interval — the exact cross-dashboard bleed this feature
    // exists to remove. null puts the page back on "Loading…" instead.
    setAgents(null);
    void refresh(activeDashboardId);
    const id = setInterval(() => void refresh(activeDashboardId), POLL_INTERVAL_MS);
    return () => clearInterval(id);
    // Keyed on the id, not the dashboard object: a rename returns a new object
    // for the same dashboard, and that shouldn't blank the table and refetch.
  }, [refresh, activeDashboardId]);

  useEffect(() => {
    if (activeDashboardId === null) {
      setMyPermissions(undefined);
      return;
    }
    // One fetch per dashboard selection, not polled like agents above — a
    // host toggling permissions live while a restricted viewer's tab is open
    // is a rare edge the 3s agent poll doesn't need to cover for this UI-only
    // nicety (the api enforces the current state regardless of what this
    // shows).
    let cancelled = false;
    void getMyDashboardPermissions(activeDashboardId)
      .then((res) => {
        if (!cancelled) setMyPermissions(res.permissions);
      })
      .catch(() => {
        // Leave it undefined (fail-open) on error — see the state's own doc
        // comment for why that's the safe default here.
      });
    return () => {
      cancelled = true;
    };
  }, [activeDashboardId]);

  /** createAgent bound to the dashboard on screen, so a new agent lands where
   *  the user is looking rather than wherever server-side selection state
   *  happens to point. Memoized on the id so AgentDashboard isn't handed a new
   *  actions object every render. */
  const actions = useMemo(
    () => ({
      ...DASHBOARD_INDEPENDENT_ACTIONS,
      createAgent: (input: CreateAgentInput) =>
        // Unreachable in practice — the create dialog only renders inside the
        // branch below, which has already narrowed activeDashboard to non-null.
        // Rejecting beats inventing a placeholder id that the api would reject
        // anyway with a message about a dashboard the user never chose.
        activeDashboardId === null
          ? Promise.reject(new Error("No dashboard is open."))
          : createAgent(input, activeDashboardId),
    }),
    [activeDashboardId],
  );

  function handleCreated(agent: CreateAgentResponse) {
    setAgents((prev) => (prev === null ? prev : applyCreated(prev, agent)));
  }

  function handleStatusChange(id: string, status: AgentStatus) {
    setAgents((prev) => (prev === null ? prev : applyStatusChange(prev, id, status)));
  }

  function handleUpdated(updated: UpdateAgentResponse) {
    setAgents((prev) => (prev === null ? prev : applyUpdated(prev, updated)));
  }

  function handleDeleted(ids: string[]) {
    setAgents((prev) => (prev === null ? prev : applyDeleted(prev, ids)));
  }

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 px-6 py-12">
      {error !== null && (
        <p className="text-sm" style={{ color: "var(--err)" }}>
          {error}
        </p>
      )}

      {/* Outside the activeDashboard gate below: an approval is an agent
          stopped mid-task waiting on a human, and it belongs to the org, not
          to whichever dashboard happens to be selected. Hiding it behind
          "create a dashboard first" would strand a blocked agent. */}
      <ApprovalsPanel />

      {/* Below approvals: a blocked agent is waiting on a human right now,
          whereas this is money leaking steadily and can wait a minute. Renders
          nothing at all until there's a finding. */}
      <SuggestionsPanel />

      {activeDashboard === null ? (
        <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
          No dashboard yet. Create one in{" "}
          <Link href="/dashboards" className="text-brand hover:underline">
            Manage Dashboards
          </Link>{" "}
          to get started.
        </p>
      ) : activeDashboard === undefined || agents === null ? (
        <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
          Loading…
        </p>
      ) : (
        <AgentDashboard
          agents={agents}
          actions={actions}
          dashboardName={activeDashboard.name}
          // Inline so it closes over the narrowed (non-null) activeDashboard;
          // the card title re-renders from this state, so no refetch is needed.
          renameDashboard={async (name) => {
            setActiveDashboard(await renameDashboard(activeDashboard.id, name));
          }}
          // Same inline-closure-over-the-narrowed-dashboard pattern as
          // renameDashboard above — AgentDashboard stays decoupled from which
          // dashboard is active and from lib/api itself.
          listDashboardMembers={() => listDashboardMembers(activeDashboard.id)}
          addDashboardMember={(email) => addDashboardMember(activeDashboard.id, email)}
          updateDashboardMemberRole={(userId, role) =>
            updateDashboardMemberRole(activeDashboard.id, userId, role)
          }
          // Prop is Promise<void> (share-dashboard-dialog.tsx only needs to
          // know the call settled — it already has userId from its own
          // confirm-dialog state), so the response body is discarded here
          // rather than widening every layer of the prop chain to match
          // lib/api.ts's own RemoveDashboardMemberResponse return type.
          removeDashboardMember={(userId) =>
            removeDashboardMember(activeDashboard.id, userId).then(() => undefined)
          }
          // Same inline-closure-over-the-narrowed-dashboard pattern as
          // renameDashboard/listDashboardMembers above.
          getDashboardRolePermissions={(role) =>
            getDashboardRolePermissions(activeDashboard.id, role)
          }
          setDashboardRolePermissions={(role, permissions) =>
            setDashboardRolePermissions(activeDashboard.id, role, permissions)
          }
          myPermissions={myPermissions}
          onCreated={handleCreated}
          onStatusChange={handleStatusChange}
          onUpdated={handleUpdated}
          onDeleted={handleDeleted}
        />
      )}
    </main>
  );
}

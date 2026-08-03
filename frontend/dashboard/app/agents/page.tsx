"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { AgentStatus } from "@tollgate/shared";
import { AgentDashboard } from "@/components/agent-dashboard";
import {
  applyCreated,
  applyDeleted,
  applyStatusChange,
  applyUpdated,
} from "@/lib/agent-list-updates";
import {
  ApiError,
  createAgent,
  deleteAgent,
  freezeAgent,
  getActiveDashboard,
  listAgents,
  listUpstreamKeys,
  renameDashboard,
  unfreezeAgent,
  updateAgent,
  type AgentListItem,
  type CreateAgentResponse,
  type Dashboard,
  type UpdateAgentResponse,
} from "@/lib/api";

const POLL_INTERVAL_MS = 3000;

const ACTIONS = {
  createAgent,
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

  const refresh = useCallback(async () => {
    try {
      const data = await listAgents();
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

  useEffect(() => {
    if (activeDashboard === undefined || activeDashboard === null) return;
    void refresh();
    const id = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refresh, activeDashboard]);

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
    <main className="mx-auto max-w-5xl px-6 py-12">
      {error !== null && (
        <p className="mb-4 text-sm" style={{ color: "var(--err)" }}>
          {error}
        </p>
      )}

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
          actions={ACTIONS}
          dashboardName={activeDashboard.name}
          // Inline so it closes over the narrowed (non-null) activeDashboard;
          // the card title re-renders from this state, so no refetch is needed.
          renameDashboard={async (name) => {
            setActiveDashboard(await renameDashboard(activeDashboard.id, name));
          }}
          onCreated={handleCreated}
          onStatusChange={handleStatusChange}
          onUpdated={handleUpdated}
          onDeleted={handleDeleted}
        />
      )}
    </main>
  );
}

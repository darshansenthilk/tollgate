"use client";

import { useCallback, useEffect, useState } from "react";
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
  listAgents,
  listUpstreamKeys,
  unfreezeAgent,
  updateAgent,
  type AgentListItem,
  type CreateAgentResponse,
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
    void refresh();
    const id = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refresh]);

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

      {agents === null ? (
        <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
          Loading…
        </p>
      ) : (
        <AgentDashboard
          agents={agents}
          actions={ACTIONS}
          onCreated={handleCreated}
          onStatusChange={handleStatusChange}
          onUpdated={handleUpdated}
          onDeleted={handleDeleted}
        />
      )}
    </main>
  );
}

"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import type { AgentStatus } from "@tollgate/shared";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { AgentStatusBadge } from "@/components/agent-status-badge";
import { CreateAgentDialog } from "@/components/create-agent-dialog";
import { FreezeAgentButton } from "@/components/freeze-agent-button";
import {
  ApiError,
  listAgents,
  type AgentListItem,
  type CreateAgentResponse,
} from "@/lib/api";

const POLL_INTERVAL_MS = 3000;
const WARNING_THRESHOLD = 0.8;

const FROZEN_STATUSES: ReadonlySet<AgentStatus> = new Set<AgentStatus>([
  "soft_frozen",
  "hard_frozen",
]);

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** Fraction of budget spent. null = unlimited (no bar/percent shown). */
function spendFraction(spend: number, max: number | null): number | null {
  if (max === null) return null;
  if (max <= 0) return 1; // zero budget = permanently at the ceiling
  return spend / max;
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<AgentListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await listAgents();
      setAgents(data);
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
    const item: AgentListItem = {
      id: agent.id,
      name: agent.name,
      providerSlug: agent.providerSlug,
      status: agent.status,
      maxBudgetCents: agent.maxBudgetCents,
      currentMonthSpendCents: 0,
    };
    setAgents((prev) => (prev === null ? [item] : [item, ...prev]));
  }

  function handleStatusChange(id: string, status: AgentStatus) {
    setAgents((prev) =>
      prev === null ? prev : prev.map((a) => (a.id === id ? { ...a, status } : a)),
    );
  }

  const needsAttention = (agents ?? []).filter(
    (a) =>
      FROZEN_STATUSES.has(a.status) ||
      (spendFraction(a.currentMonthSpendCents, a.maxBudgetCents) ?? 0) >= 1,
  );

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Agents</h1>
          <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
            Spend and enforcement status, live from Redis.
          </p>
        </div>
        <CreateAgentDialog onCreated={handleCreated} />
      </header>

      {needsAttention.length > 0 && (
        <div
          className="mb-4 rounded-lg border px-4 py-3 text-sm"
          style={{
            borderColor: "var(--err)",
            background: "color-mix(in oklch, var(--err) 10%, transparent)",
            color: "var(--err)",
          }}
        >
          <strong>
            {needsAttention.length} agent{needsAttention.length === 1 ? "" : "s"} need
            attention:
          </strong>{" "}
          {needsAttention.map((a) => a.name).join(", ")}
        </div>
      )}

      {error !== null && (
        <p className="mb-4 text-sm" style={{ color: "var(--err)" }}>
          {error}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>All agents</CardTitle>
          <CardDescription>Polling every 3s</CardDescription>
        </CardHeader>
        <CardContent>
          {agents === null ? (
            <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
              Loading…
            </p>
          ) : agents.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
              No agents yet — create one to get started.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Spend / budget</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {agents.map((agent) => {
                  const fraction = spendFraction(
                    agent.currentMonthSpendCents,
                    agent.maxBudgetCents,
                  );
                  const pct = fraction === null ? null : Math.round(fraction * 100);
                  const isFrozen = FROZEN_STATUSES.has(agent.status);
                  const overBudget = fraction !== null && fraction >= 1;
                  const warning =
                    fraction !== null && fraction >= WARNING_THRESHOLD && !overBudget;
                  const barColor =
                    overBudget || isFrozen
                      ? "var(--err)"
                      : warning
                        ? "var(--amber)"
                        : "var(--ok)";

                  return (
                    <TableRow key={agent.id}>
                      <TableCell className="font-medium">{agent.name}</TableCell>
                      <TableCell>
                        <span className="font-mono text-xs">{agent.providerSlug}</span>
                      </TableCell>
                      <TableCell>
                        <AgentStatusBadge status={agent.status} />
                      </TableCell>
                      <TableCell>
                        <div className="flex min-w-[180px] flex-col gap-1">
                          <div className="flex items-center justify-between text-xs">
                            <span>
                              {formatCents(agent.currentMonthSpendCents)}
                              {agent.maxBudgetCents !== null &&
                                ` / ${formatCents(agent.maxBudgetCents)}`}
                            </span>
                            {pct !== null && (
                              <span
                                style={{
                                  color: overBudget
                                    ? "var(--err)"
                                    : warning
                                      ? "var(--amber)"
                                      : "var(--muted-foreground)",
                                }}
                              >
                                {pct}%
                                {warning && !overBudget && " ⚠"}
                              </span>
                            )}
                          </div>
                          {agent.maxBudgetCents !== null && (
                            <Progress
                              value={Math.min(fraction ?? 0, 1) * 100}
                              className="[&_[data-slot=progress-indicator]]:bg-(--progress-color)"
                              style={{ "--progress-color": barColor } as CSSProperties}
                            />
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <FreezeAgentButton
                          agentId={agent.id}
                          agentName={agent.name}
                          status={agent.status}
                          onStatusChange={(status) => handleStatusChange(agent.id, status)}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

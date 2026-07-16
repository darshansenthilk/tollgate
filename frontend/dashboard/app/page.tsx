"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import type { AgentStatus } from "@tollgate/shared";
import { useToastManager } from "@/components/ui/toast";
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
import { StopAgentButton } from "@/components/stop-agent-button";
import { DeleteAgentButton } from "@/components/delete-agent-button";
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

/** Single source of truth for "over budget" — used by sorting, the "needs
 *  attention" banner, and over-budget transition detection alike. */
function isOverBudget(agent: AgentListItem): boolean {
  return (spendFraction(agent.currentMonthSpendCents, agent.maxBudgetCents) ?? 0) >= 1;
}

/** Over-budget agents first; within each group, alphabetical by name
 *  (case-insensitive). */
function compareAgents(a: AgentListItem, b: AgentListItem): number {
  const aOver = isOverBudget(a);
  const bOver = isOverBudget(b);
  if (aOver !== bOver) return aOver ? -1 : 1;
  return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<AgentListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { add: addToast } = useToastManager();
  // Read via a ref inside refresh() so refresh's identity (and therefore the
  // poll interval effect below) doesn't depend on addToast's own identity.
  const addToastRef = useRef(addToast);
  addToastRef.current = addToast;

  // Previous poll's over-budget state per agent id. null = no poll has
  // completed yet, which is what suppresses toasts on the very first load —
  // there's nothing to diff a transition against until this is populated.
  const prevOverBudgetRef = useRef<Map<string, boolean> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await listAgents();
      setAgents(data);
      setError(null);

      const previous = prevOverBudgetRef.current;
      const next = new Map<string, boolean>();
      for (const agent of data) {
        const over = isOverBudget(agent);
        next.set(agent.id, over);
        // A real transition: this exact agent was confirmed under/at limit
        // on the immediately preceding poll, and is over budget now.
        if (previous !== null && previous.get(agent.id) === false && over) {
          addToastRef.current({
            title: "Over budget",
            description: `${agent.name} just went over its budget.`,
          });
        }
      }
      prevOverBudgetRef.current = next;
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
      model: agent.model,
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

  function handleDeleted(id: string) {
    setAgents((prev) => (prev === null ? prev : prev.filter((a) => a.id !== id)));
  }

  const needsAttention = (agents ?? []).filter(
    (a) => FROZEN_STATUSES.has(a.status) || isOverBudget(a),
  );

  // Over-budget agents first, then alphabetical — see compareAgents.
  const sortedAgents = agents === null ? null : [...agents].sort(compareAgents);

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Agents</h1>
          <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
            Spend and enforcement status, live from Redis.
          </p>
        </div>
        <CreateAgentDialog
          onCreated={handleCreated}
          existingNames={(agents ?? []).map((a) => a.name)}
        />
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
          {sortedAgents === null ? (
            <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
              Loading…
            </p>
          ) : sortedAgents.length === 0 ? (
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
                {sortedAgents.map((agent) => {
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
                        <div className="flex justify-end gap-2">
                          <StopAgentButton
                            agentId={agent.id}
                            agentName={agent.name}
                            status={agent.status}
                            onStatusChange={(status) => handleStatusChange(agent.id, status)}
                          />
                          <DeleteAgentButton
                            agentId={agent.id}
                            agentName={agent.name}
                            onDeleted={handleDeleted}
                          />
                        </div>
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

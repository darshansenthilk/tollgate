"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { Flag, Pencil } from "lucide-react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { AgentStatusBadge } from "@/components/agent-status-badge";
import { CreateAgentDialog } from "@/components/create-agent-dialog";
import { EditAgentDialog } from "@/components/edit-agent-dialog";
import { SelectionToolbar } from "@/components/selection-toolbar";
import { AgentPromptSidebar } from "@/components/agent-prompt-sidebar";
import { isStopped } from "@/lib/agent-status";
import { cn } from "@/lib/utils";
import {
  ApiError,
  listAgents,
  type AgentListItem,
  type CreateAgentResponse,
  type UpdateAgentResponse,
} from "@/lib/api";

const POLL_INTERVAL_MS = 3000;
const WARNING_THRESHOLD = 0.8;

/** Sort choices for the control above the table. "Usage" sorts by
 *  currentMonthSpendCents (dollars), not currentMonthTokens — the Tokens
 *  column is display-only for now, not wired into this sort. */
const SORT_OPTIONS = [
  { value: "name-asc", label: "Name (A–Z)" },
  { value: "spend-desc", label: "Usage (high to low)" },
  { value: "model-asc", label: "Model (A–Z)" },
  { value: "model-desc", label: "Model (Z–A)" },
] as const;

type SortKey = (typeof SORT_OPTIONS)[number]["value"];

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
 *  attention" banner, the flagged badge, and over-budget transition
 *  detection alike. Also what "flagged" means: derived, not a persisted
 *  status — there's no backend column for it. */
function isOverBudget(agent: AgentListItem): boolean {
  return (spendFraction(agent.currentMonthSpendCents, agent.maxBudgetCents) ?? 0) >= 1;
}

/** The user-selected secondary sort, applied within the flagged/unflagged
 *  groups (see compareAgents) — never overrides the flagged-first grouping. */
function compareBySortKey(a: AgentListItem, b: AgentListItem, sortKey: SortKey): number {
  switch (sortKey) {
    case "name-asc":
      return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    case "spend-desc":
      return b.currentMonthSpendCents - a.currentMonthSpendCents;
    case "model-asc":
    case "model-desc": {
      if (a.model === null && b.model === null) return 0;
      if (a.model === null) return 1; // nulls last regardless of direction
      if (b.model === null) return -1;
      const cmp = a.model.toLowerCase().localeCompare(b.model.toLowerCase());
      return sortKey === "model-asc" ? cmp : -cmp;
    }
  }
}

/** Flagged (over-budget) agents first — this is the primary key and always
 *  wins; the chosen sort is only the secondary, within-group tiebreaker. */
function compareAgents(a: AgentListItem, b: AgentListItem, sortKey: SortKey): number {
  const aOver = isOverBudget(a);
  const bOver = isOverBudget(b);
  if (aOver !== bOver) return aOver ? -1 : 1;
  return compareBySortKey(a, b, sortKey);
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<AgentListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("name-asc");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [sidebarAgentId, setSidebarAgentId] = useState<string | null>(null);
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);

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
      // Successive polls are identical most of the time. Swapping in a fresh
      // array every 3s re-renders the whole table for nothing, and when that
      // lands mid-animation (opening the sidebar or the create dialog) it
      // shows up as a frame hitch. Keeping the previous reference when the
      // payload is unchanged lets React bail out of the render entirely —
      // same trick the selection pruning below already uses.
      setAgents((prev) =>
        prev !== null && JSON.stringify(prev) === JSON.stringify(data) ? prev : data,
      );
      setError(null);

      // Drop any selected id that no longer exists (deleted elsewhere) so
      // the toolbar's count never lags reality.
      const validIds = new Set(data.map((a) => a.id));
      setSelectedIds((prev) => {
        let changed = false;
        const next = new Set<string>();
        for (const id of prev) {
          if (validIds.has(id)) next.add(id);
          else changed = true;
        }
        return changed ? next : prev;
      });

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
      currentMonthTokens: 0,
      currentPrompt: null,
    };
    setAgents((prev) => (prev === null ? [item] : [item, ...prev]));
  }

  function handleStatusChange(id: string, status: AgentStatus) {
    setAgents((prev) =>
      prev === null ? prev : prev.map((a) => (a.id === id ? { ...a, status } : a)),
    );
  }

  /** PATCH /v1/agents/:id returns the committed row, so swap it straight in
   *  rather than waiting for the next poll. Mirrors handleStatusChange. */
  function handleUpdated(updated: UpdateAgentResponse) {
    setAgents((prev) =>
      prev === null
        ? prev
        : prev.map((a) =>
            a.id === updated.id
              ? {
                  ...a,
                  name: updated.name,
                  providerSlug: updated.providerSlug,
                  model: updated.model,
                  status: updated.status,
                  maxBudgetCents: updated.maxBudgetCents,
                }
              : a,
          ),
    );
  }

  function handleDeleted(id: string) {
    setAgents((prev) => (prev === null ? prev : prev.filter((a) => a.id !== id)));
    setSelectedIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  function handleBatchDeleted(ids: string[]) {
    const idSet = new Set(ids);
    setAgents((prev) => (prev === null ? prev : prev.filter((a) => !idSet.has(a.id))));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.delete(id);
      return next;
    });
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  /** Leaving selection mode always drops the selection, so re-entering starts
   *  clean. Also what a completed batch action calls to auto-exit. */
  function exitSelectionMode() {
    clearSelection();
    setSelectionMode(false);
  }

  const needsAttention = (agents ?? []).filter(
    (a) => isStopped(a.status) || isOverBudget(a),
  );

  // Flagged agents first (primary key), then the chosen sort (secondary,
  // within each group) — see compareAgents.
  const sortedAgents =
    agents === null ? null : [...agents].sort((a, b) => compareAgents(a, b, sortKey));

  const allIds = (sortedAgents ?? []).map((a) => a.id);
  const allSelected = allIds.length > 0 && allIds.every((id) => selectedIds.has(id));
  const someSelected = allIds.some((id) => selectedIds.has(id));
  const selectedAgents = (agents ?? []).filter((a) => selectedIds.has(a.id));

  // Re-derived from the live (polled) list every render, not a snapshot from
  // when the row was clicked — see AgentPromptSidebar's prop doc comment.
  const sidebarAgent = (agents ?? []).find((a) => a.id === sidebarAgentId) ?? null;
  const editingAgent = (agents ?? []).find((a) => a.id === editingAgentId) ?? null;

  function toggleSelectAll() {
    setSelectedIds(allSelected ? new Set() : new Set(allIds));
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <header className="mb-6 flex items-center justify-between">
        <div>
          {/* inline-block so the gradient box hugs the text — on a full-width
              block the text would only ever sample the left end of the ramp. */}
          <h1 className="inline-block bg-linear-to-r from-white to-[#9CA3AF] bg-clip-text text-3xl font-semibold tracking-tight text-transparent">
            Agent Dashboard
          </h1>
          <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
            Spend and enforcement status, live from Redis.
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <CreateAgentDialog
            onCreated={handleCreated}
            existingNames={(agents ?? []).map((a) => a.name)}
          />
          <Button
            type="button"
            variant={selectionMode ? "outline" : "amber"}
            onClick={() => {
              if (selectionMode) exitSelectionMode();
              else setSelectionMode(true);
            }}
          >
            {selectionMode ? "Done" : "Select agents"}
          </Button>
        </div>
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
          <div className="mb-3 flex items-center gap-2">
            <Label htmlFor="agent-sort" className="text-xs" style={{ color: "var(--muted-foreground)" }}>
              Sort by
            </Label>
            <Select
              items={SORT_OPTIONS}
              value={sortKey}
              onValueChange={(value) => {
                if (value !== null) setSortKey(value);
              }}
            >
              <SelectTrigger id="agent-sort" className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SORT_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectionMode && selectedAgents.length > 0 && (
            <SelectionToolbar
              selectedAgents={selectedAgents}
              onDeleted={handleBatchDeleted}
              onStatusChange={handleStatusChange}
              onClearSelection={clearSelection}
              onCompleted={exitSelectionMode}
            />
          )}

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
                  {/* Always mounted so the column can animate open and closed —
                      conditionally rendering it would snap the other columns
                      sideways instead of sliding them. The width transition
                      lives on the inner div, not the cell: `table-layout: auto`
                      derives column widths from content and ignores a width set
                      on the <th> itself. */}
                  <TableHead className="w-0 p-0">
                    <div
                      className={cn(
                        "overflow-hidden transition-[width] duration-300 ease-out motion-reduce:transition-none",
                        selectionMode ? "w-10" : "w-0",
                      )}
                    >
                      <div className="flex w-10 items-center justify-center">
                        {selectionMode && (
                          <Checkbox
                            checked={allSelected}
                            indeterminate={someSelected && !allSelected}
                            onCheckedChange={toggleSelectAll}
                            aria-label="Select all agents"
                            className="animate-in fade-in zoom-in-75 duration-200 motion-reduce:animate-none"
                          />
                        )}
                      </div>
                    </div>
                  </TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Assistant</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Spend / budget</TableHead>
                  <TableHead>Tokens</TableHead>
                  <TableHead className="w-0">
                    <span className="sr-only">Edit</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedAgents.map((agent) => {
                  const fraction = spendFraction(
                    agent.currentMonthSpendCents,
                    agent.maxBudgetCents,
                  );
                  const pct = fraction === null ? null : Math.round(fraction * 100);
                  const isFrozen = isStopped(agent.status);
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
                      <TableCell className="w-0 p-0">
                        <div
                          className={cn(
                            "overflow-hidden transition-[width] duration-300 ease-out motion-reduce:transition-none",
                            selectionMode ? "w-10" : "w-0",
                          )}
                        >
                          <div className="flex w-10 items-center justify-center">
                            {selectionMode && (
                              <Checkbox
                                checked={selectedIds.has(agent.id)}
                                onCheckedChange={() => toggleSelected(agent.id)}
                                aria-label={`Select ${agent.name}`}
                                className="animate-in fade-in zoom-in-75 duration-200 motion-reduce:animate-none"
                              />
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell
                        className="cursor-pointer font-medium"
                        onClick={() => setSidebarAgentId(agent.id)}
                      >
                        <span className="flex items-center gap-1.5">
                          {overBudget && (
                            <Flag
                              className="size-3.5 shrink-0"
                              style={{ color: "var(--err)" }}
                              aria-label="Flagged: over budget"
                            />
                          )}
                          {agent.name}
                        </span>
                      </TableCell>
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
                      <TableCell>
                        <span className="font-mono text-xs">
                          {agent.currentMonthTokens.toLocaleString()}
                        </span>
                      </TableCell>
                      {/* No stopPropagation needed: only the Name cell above
                          carries an onClick, so this can't open the sidebar. */}
                      <TableCell className="w-0 text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Edit ${agent.name}`}
                          onClick={() => setEditingAgentId(agent.id)}
                          // No square on hover — just the pen. Overrides the
                          // ghost variant's hover fill (both themes).
                          className="hover:bg-transparent dark:hover:bg-transparent"
                        >
                          <Pencil
                            className="size-3.5 group-hover/button:animate-pen-shake motion-reduce:animate-none"
                            strokeWidth={1.75}
                          />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <AgentPromptSidebar
        agent={sidebarAgent}
        onOpenChange={(open) => {
          if (!open) setSidebarAgentId(null);
        }}
      />

      {/* One dialog for the whole table, driven by an id — not one per row.
          Base UI dialog mount costs ~60-110ms, so a per-row instance would
          multiply that across every row. */}
      <EditAgentDialog
        agent={editingAgent}
        onOpenChange={(open) => {
          if (!open) setEditingAgentId(null);
        }}
        onUpdated={handleUpdated}
        existingNames={(agents ?? []).map((a) => a.name)}
      />
    </main>
  );
}

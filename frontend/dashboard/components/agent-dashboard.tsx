"use client";

import { useState, type CSSProperties } from "react";
import { Bot, Pencil, Users } from "lucide-react";
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
import { AgentAttentionAlerts } from "@/components/agent-attention-alerts";
import { isStopped } from "@/lib/agent-status";
import { isOverBudget, spendFraction } from "@/lib/agent-budget";
import { cn } from "@/lib/utils";
import type {
  AgentListItem,
  AgentMutationResponse,
  CreateAgentInput,
  CreateAgentResponse,
  UpdateAgentInput,
  UpdateAgentResponse,
} from "@/lib/api";

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

/**
 * Everything the mutation dialogs need, matching lib/api.ts's real function
 * signatures exactly. Injected rather than imported so this same component
 * (and the dialogs it renders) work unmodified against either the real api
 * or the marketing page's client-side demo simulator.
 */
export interface AgentDashboardActions {
  createAgent: (input: CreateAgentInput) => Promise<CreateAgentResponse>;
  updateAgent: (id: string, input: UpdateAgentInput) => Promise<UpdateAgentResponse>;
  freezeAgent: (id: string, mode: "soft" | "hard") => Promise<AgentMutationResponse>;
  unfreezeAgent: (id: string) => Promise<AgentMutationResponse>;
  deleteAgent: (id: string) => Promise<AgentMutationResponse>;
}

interface AgentDashboardProps {
  agents: AgentListItem[];
  actions: AgentDashboardActions;
  /** The parent owns the agents array (real page: polled from the api; demo:
   *  the simulator's own state) — these patch it via lib/agent-list-updates.ts's
   *  pure functions on the caller's side. */
  onCreated: (agent: CreateAgentResponse) => void;
  onStatusChange: (id: string, status: AgentStatus) => void;
  onUpdated: (agent: UpdateAgentResponse) => void;
  onDeleted: (ids: string[]) => void;
  /** "absolute" for the marketing demo replica (contained within its own
   *  `position: relative` panel); "fixed" (default) for the real dashboard,
   *  pinned to the real viewport. See AgentAttentionAlerts's own prop doc. */
  attentionAlertsPosition?: "fixed" | "absolute";
}

/**
 * The dashboard's presentational shell — header, sort control, selection
 * mode + table, prompt sidebar, attention alerts, create/edit dialogs. Owns
 * only local UI state (sort, selection, which sidebar/dialog is open); the
 * agents array itself and every mutation are the parent's responsibility, so
 * the exact same component renders both the real dashboard (app/agents/page.tsx)
 * and the marketing page's live demo.
 */
export function AgentDashboard({
  agents,
  actions,
  onCreated,
  onStatusChange,
  onUpdated,
  onDeleted,
  attentionAlertsPosition = "fixed",
}: AgentDashboardProps) {
  const [sortKey, setSortKey] = useState<SortKey>("name-asc");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [sidebarAgentId, setSidebarAgentId] = useState<string | null>(null);
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);

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

  /** Patches the parent's agents array via onDeleted, then locally drops the
   *  now-gone ids from the selection so the toolbar's count stays accurate. */
  function handleBatchDeleted(ids: string[]) {
    onDeleted(ids);
    const idSet = new Set(ids);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of idSet) next.delete(id);
      return next;
    });
  }

  // Flagged agents first (primary key), then the chosen sort (secondary,
  // within each group) — see compareAgents.
  const sortedAgents = [...agents].sort((a, b) => compareAgents(a, b, sortKey));

  const allIds = sortedAgents.map((a) => a.id);
  const allSelected = allIds.length > 0 && allIds.every((id) => selectedIds.has(id));
  const someSelected = allIds.some((id) => selectedIds.has(id));
  const selectedAgents = agents.filter((a) => selectedIds.has(a.id));

  // Re-derived from the live agents list every render, not a snapshot from
  // when the row was clicked — see AgentPromptSidebar's prop doc comment.
  const sidebarAgent = agents.find((a) => a.id === sidebarAgentId) ?? null;
  const editingAgent = agents.find((a) => a.id === editingAgentId) ?? null;

  function toggleSelectAll() {
    setSelectedIds(allSelected ? new Set() : new Set(allIds));
  }

  return (
    <>
      <header className="mb-6 flex items-center justify-between">
        <div>
          {/* Bracketed title in the template's eyebrow idiom — coral mono
              brackets flanking the wordmark. inline-block on the h1 keeps
              bg-clip-text hugging the text so the white→coral ramp samples
              across the word, not the whole row. */}
          <div className="flex items-baseline gap-2">
            {/* -6px pulls the bracket's glyph ink (which the monospace font
                insets ~5px from its box) left to line up under the subtitle's
                first character. Measured, not eyeballed. */}
            {/* Brackets converge inward on load: the left one enters from
                farther left, the right from farther right, settling onto the
                stationary title. inline-block so the translate applies (transform
                is a no-op on inline boxes). motion-reduce opts out. */}
            <span
              aria-hidden
              className="-ml-[6px] inline-block font-mono text-3xl font-normal text-brand animate-in slide-in-from-left-6 duration-500 ease-out motion-reduce:animate-none"
            >
              [
            </span>
            <h1 className="inline-block bg-linear-to-r from-white to-brand bg-clip-text font-heading text-[2.34rem] font-semibold tracking-tight text-transparent">
              Agent Dashboard
            </h1>
            <span
              aria-hidden
              className="inline-block font-mono text-3xl font-normal text-brand animate-in slide-in-from-right-6 duration-500 ease-out motion-reduce:animate-none"
            >
              ]
            </span>
          </div>
          <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
            Your group of agents, all managed in one place.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <CreateAgentDialog
            createAgent={actions.createAgent}
            onCreated={onCreated}
            existingNames={agents.map((a) => a.name)}
          />
          <Button
            type="button"
            variant={selectionMode ? "outline" : "amberOutline"}
            onClick={() => {
              if (selectionMode) exitSelectionMode();
              else setSelectionMode(true);
            }}
          >
            {selectionMode ? (
              "Done"
            ) : (
              <>
                <Users />
                Select agents
              </>
            )}
          </Button>
        </div>
      </header>

      <Card className="relative">
        {/* Coral hairline along the card's top edge, fading out at both ends.
            Tailwind v4 renames bg-gradient-* → bg-linear-*. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-brand to-transparent"
        />
        <CardHeader>
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="flex size-9 shrink-0 items-center justify-center rounded-lg border text-brand"
              style={{
                borderColor: "color-mix(in oklch, var(--brand) 35%, transparent)",
                backgroundColor: "color-mix(in oklch, var(--brand) 12%, transparent)",
              }}
            >
              <Users className="size-4" />
            </span>
            <div>
              <CardTitle>All agents</CardTitle>
              <CardDescription className="flex items-center gap-1.5">
                Polling every 3s
                <span
                  aria-hidden
                  className="size-1.5 rounded-full animate-pulse motion-reduce:animate-none"
                  style={{ backgroundColor: "var(--ok)" }}
                />
              </CardDescription>
            </div>
          </div>
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

          {selectionMode && (
            <SelectionToolbar
              selectedAgents={selectedAgents}
              freezeAgent={actions.freezeAgent}
              unfreezeAgent={actions.unfreezeAgent}
              deleteAgent={actions.deleteAgent}
              onDeleted={handleBatchDeleted}
              onStatusChange={onStatusChange}
              onCompleted={exitSelectionMode}
            />
          )}

          {sortedAgents.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
              No agents yet — create one to get started.
            </p>
          ) : (
            <div className="overflow-hidden rounded-lg border">
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
                          <span className="flex items-center gap-2">
                            <span
                              aria-hidden
                              className="flex size-7 shrink-0 items-center justify-center rounded-md border text-brand"
                              style={{
                                borderColor:
                                  "color-mix(in oklch, var(--brand) 35%, transparent)",
                                backgroundColor:
                                  "color-mix(in oklch, var(--brand) 12%, transparent)",
                              }}
                            >
                              <Bot className="size-3.5" strokeWidth={1.75} />
                            </span>
                            {agent.name}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="font-mono text-xs">{agent.providerSlug}</span>
                        </TableCell>
                        <TableCell>
                          <AgentStatusBadge status={agent.status} flagged={overBudget} />
                        </TableCell>
                        <TableCell>
                          {/* Amount on its own line; the bar and the percentage
                              then share a row beneath it. */}
                          <div className="flex min-w-[180px] flex-col gap-1">
                            <span className="text-xs">
                              {formatCents(agent.currentMonthSpendCents)}
                              {agent.maxBudgetCents !== null &&
                                ` / ${formatCents(agent.maxBudgetCents)}`}
                            </span>
                            {(agent.maxBudgetCents !== null || pct !== null) && (
                              <div className="flex items-center gap-2">
                                {agent.maxBudgetCents !== null && (
                                  <Progress
                                    value={Math.min(fraction ?? 0, 1) * 100}
                                    className="flex-1 [&_[data-slot=progress-indicator]]:bg-(--progress-color)"
                                    style={{ "--progress-color": barColor } as CSSProperties}
                                  />
                                )}
                                {pct !== null && (
                                  <span
                                    className="shrink-0 text-xs tabular-nums"
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
                            variant="outline"
                            size="icon-sm"
                            aria-label={`Edit ${agent.name}`}
                            onClick={() => setEditingAgentId(agent.id)}
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
            </div>
          )}
        </CardContent>
      </Card>

      <AgentPromptSidebar
        agent={sidebarAgent}
        onOpenChange={(open) => {
          if (!open) setSidebarAgentId(null);
        }}
      />

      <AgentAttentionAlerts
        agents={agents}
        freezeAgent={actions.freezeAgent}
        unfreezeAgent={actions.unfreezeAgent}
        onStatusChange={onStatusChange}
        variant={attentionAlertsPosition}
      />

      {/* One dialog for the whole table, driven by an id — not one per row.
          Base UI dialog mount costs ~60-110ms, so a per-row instance would
          multiply that across every row. */}
      <EditAgentDialog
        agent={editingAgent}
        updateAgent={actions.updateAgent}
        onOpenChange={(open) => {
          if (!open) setEditingAgentId(null);
        }}
        onUpdated={onUpdated}
        existingNames={agents.map((a) => a.name)}
      />
    </>
  );
}

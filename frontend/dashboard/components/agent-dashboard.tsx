"use client";

import { useState, type CSSProperties } from "react";
import { Bot, HardHat, Pencil, Plug, Users } from "lucide-react";
import type { AgentStatus, DashboardMemberRole, DashboardPermissionAction } from "@tollgate/shared";
import {
  Card,
  CardAction,
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
import { AgentIntegrationDialog } from "@/components/agent-integration-dialog";
import { RenameDashboardDialog } from "@/components/rename-dashboard-dialog";
import { ShareDashboardDialog } from "@/components/share-dashboard-dialog";
import { SharePermissionsDialog } from "@/components/share-permissions-dialog";
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
  DashboardMember,
  DashboardMembersResponse,
  DashboardRolePermissions,
  UpdateAgentInput,
  UpdateAgentResponse,
  UpdateDashboardMemberRoleResponse,
  UpstreamKeysResponse,
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
  /**
   * Optional: lets the create/edit dialogs offer "which stored BYOK key
   * should this agent use" when the org has any. Omitted on the marketing
   * page's demo simulator (no real org/session to fetch keys for), in which
   * case the dialogs simply skip that field — same pattern as every other
   * action here, injected rather than imported so this component works
   * unmodified against either the real api or the demo.
   */
  listUpstreamKeys?: () => Promise<UpstreamKeysResponse>;
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
  /** Title of the agent table's card — the active dashboard's name on the real
   *  page. Optional because the marketing demo has no dashboard concept at all;
   *  it keeps the generic "All agents" wording this defaults to. */
  dashboardName?: string;
  /** Renames the dashboard named above. Injected like `actions` rather than
   *  imported, so this component stays usable without a real api. Omitted by
   *  the marketing demo, which then renders no edit affordance at all. */
  renameDashboard?: (name: string) => Promise<void>;
  /**
   * Dashboard sharing (the share button + dialog). Both optional and both
   * required together — the caller supplies neither, or both, the same
   * gating style `renameDashboard` already uses — so the marketing demo
   * (which has no dashboard to share) renders no share affordance at all.
   * Bound to the active dashboard's id by the caller, same as renameDashboard.
   */
  listDashboardMembers?: () => Promise<DashboardMembersResponse>;
  addDashboardMember?: (email: string) => Promise<DashboardMember>;
  /** Host-only role reassignment — see ShareDashboardDialog's own doc comment
   *  for why only the host ever calls this. Gated together with the two props
   *  above; the marketing demo supplies none of the three. */
  updateDashboardMemberRole?: (
    userId: string,
    role: DashboardMemberRole,
  ) => Promise<UpdateDashboardMemberRoleResponse>;
  /** Host-only member removal — same optional/paired-with-sharing gating as
   *  updateDashboardMemberRole above. Undefined for the marketing demo. */
  removeDashboardMember?: (userId: string) => Promise<void>;
  /**
   * The role-permission delegation popup (the HardHat button). Both optional
   * and both required together, same gating style as the sharing props above
   * — undefined for the marketing demo, which has no dashboard to delegate
   * permissions on.
   */
  getDashboardRolePermissions?: (role: DashboardMemberRole) => Promise<DashboardRolePermissions>;
  setDashboardRolePermissions?: (
    role: DashboardMemberRole,
    permissions: Partial<Record<DashboardPermissionAction, boolean>>,
  ) => Promise<DashboardRolePermissions>;
  /**
   * The viewer's OWN standing on the 6 gated actions (GET .../my-permissions),
   * so restricted actions can be hidden/disabled instead of only failing with
   * a 403 after the click — PLAN.md's frontend work. Undefined (not just an
   * all-false object) means "not known yet, or not applicable" — the
   * marketing demo never supplies it, and the real page hasn't necessarily
   * resolved it on first paint — and is treated as fully permitted rather
   * than fully restricted: the api is the actual enforcement boundary, so
   * fail-open here is a UI nicety, not a security decision.
   */
  myPermissions?: Record<DashboardPermissionAction, boolean>;
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
  dashboardName = "All agents",
  renameDashboard,
  listDashboardMembers,
  addDashboardMember,
  updateDashboardMemberRole,
  removeDashboardMember,
  getDashboardRolePermissions,
  setDashboardRolePermissions,
  myPermissions,
}: AgentDashboardProps) {
  const [renamingDashboard, setRenamingDashboard] = useState(false);
  const [sharingDashboard, setSharingDashboard] = useState(false);
  const [managingPermissions, setManagingPermissions] = useState(false);
  // Fail-open per myPermissions' own doc comment — an absent flag (undefined
  // object, or a key that hasn't loaded) reads as "allowed".
  const canCreateAgent = myPermissions?.createAgent ?? true;
  const canUpdateAgent = myPermissions?.updateAgent ?? true;
  const canFreezeAgent = myPermissions?.freezeAgent ?? true;
  const canUnfreezeAgent = myPermissions?.unfreezeAgent ?? true;
  const canDeleteAgent = myPermissions?.deleteAgent ?? true;
  const canAddDashboardMember = myPermissions?.addDashboardMember ?? true;
  const [sortKey, setSortKey] = useState<SortKey>("name-asc");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [sidebarAgentId, setSidebarAgentId] = useState<string | null>(null);
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const [integrationAgentId, setIntegrationAgentId] = useState<string | null>(null);

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
  const integrationAgent = agents.find((a) => a.id === integrationAgentId) ?? null;

  function toggleSelectAll() {
    setSelectedIds(allSelected ? new Set() : new Set(allIds));
  }

  return (
    <>
      <header className="mb-6 flex items-center justify-between">
        {/* pl-4 matches Card's own --card-spacing (16px) below, so the
            heading's left edge lines up with the card's inner content (the
            icon chip) rather than just its outer border — they were both
            sitting flush at the container edge before, which put the card's
            padded content visibly to the right of the plain-text heading.
            text-left is explicit, not the default here: the marketing
            live-demo panel wraps this component in .mk-centered
            (globals.css's site-wide text-align: center for that section),
            which would otherwise centre this header and break the
            "Your group of" / "agents, ..." line-start alignment below. */}
        <div className="pl-4 text-left">
          {/* Plain heading — the coral bracket marks + white→brand gradient
              clip were the same eyebrow idiom retired on the landing page.
              Weight/tracking match mk-display-xs's sub-heading scale rather
              than reusing font-heading (Space Grotesk), so a dashboard user
              moving between this page and the marketing demo sees one
              typographic voice, not two. */}
          <h1 className="text-[2.1rem] font-medium tracking-[-0.02em]">Agent Dashboard</h1>
          <p className="text-sm whitespace-nowrap" style={{ color: "var(--muted-foreground)" }}>
            Your group of agents, all managed in one place.
          </p>
        </div>
        {/* Stack vertically below md (768px), not sm (640px) — at widths in
            between, the header row was still tight enough for the two
            buttons to crowd the title rather than breaking cleanly. */}
        <div className="flex flex-col items-stretch gap-2 md:flex-row md:items-center">
          {/* Hidden rather than disabled — canCreateAgent's own doc comment
              (myPermissions) explains why a restricted Observer's create
              affordance disappears instead of 403ing on click. */}
          {canCreateAgent && (
            <CreateAgentDialog
              createAgent={actions.createAgent}
              listUpstreamKeys={actions.listUpstreamKeys}
              onCreated={onCreated}
              existingNames={agents.map((a) => a.name)}
            />
          )}
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
        <CardHeader>
          {/* No icon chip on the left anymore — it moved to the top right
              below as the real share button, so this column now fills the
              space it used to sit in rather than staying indented past it. */}
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              {/* wrap-anywhere, not break-words: a 50-character name with no
                  spaces (Platform_Engineering_Team_…) has a min-content width
                  wider than the card, and overflow-wrap:break-word is excluded
                  from min-content sizing — so the title box never shrinks, and
                  the shrink-0 pen button next to it gets pushed past Card's
                  overflow-hidden edge and clipped away entirely. anywhere DOES
                  reduce min-content; the min-w-0 chain above lets that shrink
                  actually propagate up through the flex/grid ancestors. */}
              <CardTitle className="min-w-0 wrap-anywhere">{dashboardName}</CardTitle>
              {/* Same button and pen-shake hover as each row's Edit control
                  below. Rendered only when a rename action is supplied — the
                  marketing demo has no dashboard to rename. */}
              {renameDashboard !== undefined && (
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  aria-label={`Rename ${dashboardName}`}
                  onClick={() => setRenamingDashboard(true)}
                >
                  <Pencil
                    className="size-3.5 group-hover/button:animate-pen-shake motion-reduce:animate-none"
                    strokeWidth={1.75}
                  />
                </Button>
              )}
            </div>
            <CardDescription className="flex items-center gap-1.5">
              Polling every 3s
              <span
                aria-hidden
                className="size-1.5 rounded-full animate-pulse motion-reduce:animate-none"
                style={{ backgroundColor: "var(--ok)" }}
              />
            </CardDescription>
          </div>
          {/* CardAction pins to CardHeader's top-right corner (its own
              has-data-[slot=card-action] grid rule) — the same slot the
              decorative chip used to occupy on the left, now a pair of real
              buttons. CardAction wraps a single child, so the flex wrapper
              below holds both — same pattern as the title+rename-pencil pair
              above. Each button is rendered only when its own actions are
              supplied, so either can be present without the other. */}
          {((getDashboardRolePermissions !== undefined &&
            setDashboardRolePermissions !== undefined) ||
            (listDashboardMembers !== undefined && addDashboardMember !== undefined)) && (
            <CardAction>
              <div className="flex items-center gap-2">
                {getDashboardRolePermissions !== undefined &&
                  setDashboardRolePermissions !== undefined && (
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-lg"
                      aria-label={`Manage role permissions for ${dashboardName}`}
                      onClick={() => setManagingPermissions(true)}
                    >
                      <HardHat className="size-4" style={{ color: "var(--muted-foreground)" }} />
                    </Button>
                  )}
                {listDashboardMembers !== undefined && addDashboardMember !== undefined && (
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-lg"
                    aria-label={`Manage who has access to ${dashboardName}`}
                    onClick={() => setSharingDashboard(true)}
                  >
                    <Users className="size-4" style={{ color: "var(--muted-foreground)" }} />
                  </Button>
                )}
              </div>
            </CardAction>
          )}
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
              canFreeze={canFreezeAgent}
              canUnfreeze={canUnfreezeAgent}
              canDelete={canDeleteAgent}
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
                              className="flex size-7 shrink-0 items-center justify-center rounded-md border"
                              style={{ borderColor: "var(--line)", backgroundColor: "var(--panel)" }}
                            >
                              <Bot
                                className="size-3.5"
                                strokeWidth={1.75}
                                style={{ color: "var(--muted-foreground)" }}
                              />
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
                          <div className="flex items-center justify-end gap-1.5">
                            <Button
                              type="button"
                              variant="outline"
                              size="icon-sm"
                              aria-label={`Connect ${agent.name}`}
                              onClick={() => setIntegrationAgentId(agent.id)}
                            >
                              <Plug className="size-3.5" strokeWidth={1.75} />
                            </Button>
                            {canUpdateAgent && (
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
                            )}
                          </div>
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
        canFreeze={canFreezeAgent}
        canUnfreeze={canUnfreezeAgent}
        onStatusChange={onStatusChange}
        variant={attentionAlertsPosition}
      />

      {/* One dialog for the whole table, driven by an id — not one per row.
          Base UI dialog mount costs ~60-110ms, so a per-row instance would
          multiply that across every row. */}
      <EditAgentDialog
        agent={editingAgent}
        updateAgent={actions.updateAgent}
        listUpstreamKeys={actions.listUpstreamKeys}
        onOpenChange={(open) => {
          if (!open) setEditingAgentId(null);
        }}
        onUpdated={onUpdated}
        existingNames={agents.map((a) => a.name)}
      />

      <AgentIntegrationDialog
        agent={integrationAgent}
        onOpenChange={(open) => {
          if (!open) setIntegrationAgentId(null);
        }}
      />

      {renameDashboard !== undefined && (
        <RenameDashboardDialog
          open={renamingDashboard}
          currentName={dashboardName}
          renameDashboard={renameDashboard}
          onOpenChange={setRenamingDashboard}
        />
      )}

      {listDashboardMembers !== undefined && addDashboardMember !== undefined && (
        <ShareDashboardDialog
          open={sharingDashboard}
          dashboardName={dashboardName}
          listDashboardMembers={listDashboardMembers}
          addDashboardMember={addDashboardMember}
          updateDashboardMemberRole={updateDashboardMemberRole}
          removeDashboardMember={removeDashboardMember}
          canAddMember={canAddDashboardMember}
          onOpenChange={setSharingDashboard}
        />
      )}

      {getDashboardRolePermissions !== undefined && setDashboardRolePermissions !== undefined && (
        <SharePermissionsDialog
          open={managingPermissions}
          dashboardName={dashboardName}
          getDashboardRolePermissions={getDashboardRolePermissions}
          setDashboardRolePermissions={setDashboardRolePermissions}
          onOpenChange={setManagingPermissions}
        />
      )}
    </>
  );
}

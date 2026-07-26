"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import type { AgentStatus } from "@tollgate/shared";
import { Button } from "@/components/ui/button";
import { BatchStopDialog } from "@/components/batch-stop-dialog";
import { isStopped } from "@/lib/agent-status";
import { isOverBudget } from "@/lib/agent-budget";
import { cn } from "@/lib/utils";
import type { AgentListItem, AgentMutationResponse } from "@/lib/api";

const DISPLAY_MS = 10_000;
const EXIT_DURATION_MS = 200;

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

interface Alert {
  /** agentId + fire time, not just agentId — an agent can cross the ceiling,
   *  get resolved, and cross it again later, and each crossing gets its own
   *  popup. */
  id: string;
  agentId: string;
}

interface AgentAttentionAlertsProps {
  agents: AgentListItem[];
  /** Pass-through to the Stop/Resume dialog rendered on expand — see
   *  batch-stop-dialog.tsx's prop docs for why these are injected. */
  freezeAgent: (id: string, mode: "soft" | "hard") => Promise<AgentMutationResponse>;
  unfreezeAgent: (id: string) => Promise<AgentMutationResponse>;
  onStatusChange: (id: string, status: AgentStatus) => void;
  /** "fixed" (default) pins to the real viewport's top-right corner — right
   *  for the real dashboard. The marketing page's demo replica passes
   *  "absolute" so the popup stays contained within the ~920px replica panel
   *  (which must be `position: relative`) instead of floating over the whole
   *  marketing page — this component isn't portaled, so plain positioning
   *  works, unlike AgentPromptSidebar's base-ui portal. */
  variant?: "fixed" | "absolute";
}

/**
 * Liquid-glass popups, top-right corner, one per agent that just crossed its
 * budget ceiling ("flagged" — see lib/agent-budget.ts's isOverBudget). Newest
 * renders first and pushes earlier ones down via normal flow. Each popup
 * auto-dismisses after DISPLAY_MS unless expanded (reading the prompt /
 * deciding to stop or continue), in which case the clock pauses and restarts
 * fresh on collapse.
 */
export function AgentAttentionAlerts({
  agents,
  freezeAgent,
  unfreezeAgent,
  onStatusChange,
  variant = "fixed",
}: AgentAttentionAlertsProps) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [closingIds, setClosingIds] = useState<Set<string>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // Last-seen over-budget state per agent id — only used to detect a
  // false→true transition, not re-derived from `agents` every render.
  const overBudgetRef = useRef<Map<string, boolean>>(new Map());
  // Suppresses alerts on the very first poll: there's nothing to diff a
  // transition against until a baseline exists.
  const firstRunRef = useRef(true);

  const dismiss = useCallback((id: string) => {
    const pending = timersRef.current.get(id);
    if (pending !== undefined) clearTimeout(pending);
    setClosingIds((prev) => new Set(prev).add(id));
    setExpandedId((prev) => (prev === id ? null : prev));
    const exitTimer = setTimeout(() => {
      setAlerts((prev) => prev.filter((a) => a.id !== id));
      setClosingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      timersRef.current.delete(id);
    }, EXIT_DURATION_MS);
    timersRef.current.set(id, exitTimer);
  }, []);

  const scheduleDismiss = useCallback(
    (id: string) => {
      timersRef.current.set(
        id,
        setTimeout(() => dismiss(id), DISPLAY_MS),
      );
    },
    [dismiss],
  );

  useEffect(() => {
    const previous = overBudgetRef.current;
    const next = new Map<string, boolean>();
    const firstRun = firstRunRef.current;
    firstRunRef.current = false;

    for (const agent of agents) {
      const over = isOverBudget(agent);
      next.set(agent.id, over);
      // A real transition: confirmed under/at the ceiling on the previous
      // poll, over it now.
      if (!firstRun && previous.get(agent.id) === false && over) {
        const id = `${agent.id}-${Date.now()}`;
        setAlerts((prev) => [{ id, agentId: agent.id }, ...prev]);
        scheduleDismiss(id);
      }
    }
    overBudgetRef.current = next;
  }, [agents, scheduleDismiss]);

  // Belt-and-suspenders: clear every pending timer if the whole stack unmounts.
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
    };
  }, []);

  function toggleExpanded(id: string) {
    const willExpand = expandedId !== id;
    setExpandedId(willExpand ? id : null);
    const pending = timersRef.current.get(id);
    if (pending !== undefined) clearTimeout(pending);
    if (!willExpand) scheduleDismiss(id);
  }

  if (alerts.length === 0) return null;

  return (
    <div
      className={cn(
        "top-4 right-4 z-50 flex w-full max-w-sm flex-col gap-3",
        variant === "fixed" ? "fixed" : "absolute",
      )}
    >
      {alerts.map((alert) => {
        const agent = agents.find((a) => a.id === alert.agentId);
        if (agent === undefined) return null;

        const expanded = expandedId === alert.id;
        const closing = closingIds.has(alert.id);
        const hasPrompt = agent.currentPrompt !== null && agent.currentPrompt.trim() !== "";
        const stopped = isStopped(agent.status);

        return (
          <div
            key={alert.id}
            role="alert"
            onClick={() => !closing && toggleExpanded(alert.id)}
            className={cn(
              // Liquid-glass card — same recipe as ui/sidebar.tsx's panel:
              // translucent + blurred + saturated backdrop behind a glass-rim
              // inset highlight, gated behind `supports-backdrop-filter:` so
              // browsers without it get a plainer, more opaque fallback.
              "cursor-pointer overflow-hidden rounded-xl border border-white/15 bg-popover/90 p-3 text-sm text-popover-foreground shadow-[0_25px_50px_-12px_rgba(0,0,0,0.5),inset_1px_0_0_0_rgba(255,255,255,0.08),inset_0_1px_0_0_rgba(255,255,255,0.12)] outline-none duration-300 ease-out supports-backdrop-filter:bg-popover/55 supports-backdrop-filter:backdrop-blur-2xl supports-backdrop-filter:backdrop-saturate-150",
              closing
                ? "animate-out fade-out-0 slide-out-to-right duration-200"
                : "animate-in fade-in-0 slide-in-from-right duration-300",
            )}
          >
            <div className="flex items-start gap-2">
              <AlertTriangle
                className="mt-0.5 size-4 shrink-0"
                style={{ color: "var(--err)" }}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{agent.name} needs attention</p>
                <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
                  {formatCents(agent.currentMonthSpendCents)}
                  {agent.maxBudgetCents !== null && ` / ${formatCents(agent.maxBudgetCents)}`}
                </p>
              </div>
              <button
                type="button"
                aria-label="Dismiss"
                onClick={(e) => {
                  e.stopPropagation();
                  dismiss(alert.id);
                }}
                className="shrink-0 rounded-md p-0.5 text-muted-foreground transition-colors hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            </div>

            {/* Always mounted (never conditionally rendered) so the height
                change itself can animate: a `0fr` → `1fr` row track is the
                CSS-only way to transition to/from a dynamic ("auto") content
                height without measuring it in JS. The inner overflow-hidden
                clips the content while the row track's height interpolates. */}
            <div
              className={cn(
                "grid transition-[grid-template-rows] duration-300 ease-out",
                expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
              )}
            >
              <div className="overflow-hidden" aria-hidden={!expanded} inert={!expanded}>
                <div
                  className="mt-3 flex flex-col gap-2 border-t border-white/10 pt-3"
                  onClick={(e) => e.stopPropagation()}
                >
                  <p className="text-xs font-medium" style={{ color: "var(--muted-foreground)" }}>
                    Currently working on
                  </p>
                  {hasPrompt ? (
                    <pre className="max-h-32 overflow-y-auto rounded-lg border border-white/10 bg-white/5 p-2 text-xs break-words whitespace-pre-wrap">
                      {agent.currentPrompt}
                    </pre>
                  ) : (
                    <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
                      No recent activity — nothing in flight right now.
                    </p>
                  )}
                  {agent.status === "archived" ? null : stopped ? (
                    <BatchStopDialog
                      mode="resume"
                      agents={[{ id: agent.id, name: agent.name }]}
                      freezeAgent={freezeAgent}
                      unfreezeAgent={unfreezeAgent}
                      onStatusChange={onStatusChange}
                    />
                  ) : (
                    <div className="flex items-center gap-2">
                      <BatchStopDialog
                        mode="stop"
                        agents={[{ id: agent.id, name: agent.name }]}
                        freezeAgent={freezeAgent}
                        unfreezeAgent={unfreezeAgent}
                        onStatusChange={onStatusChange}
                      />
                      <Button type="button" variant="ghost" size="sm" onClick={() => dismiss(alert.id)}>
                        Continue
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

"use client";

import { useState } from "react";
import type { AgentStatus } from "@tollgate/shared";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ApiError, type AgentMutationResponse } from "@/lib/api";

type BatchStopMode = "stop" | "resume";

interface BatchStopDialogProps {
  agents: { id: string; name: string }[];
  mode: BatchStopMode;
  /** Injected so the exact same dialog works against the real api
   *  (lib/api.ts's freezeAgent/unfreezeAgent) or the marketing page's demo
   *  simulator. */
  freezeAgent: (id: string, mode: "soft" | "hard") => Promise<AgentMutationResponse>;
  unfreezeAgent: (id: string) => Promise<AgentMutationResponse>;
  /** When true the trigger is greyed and unclickable — used when no selected
   *  agent is eligible for this action, so the toolbar keeps a stable shape
   *  instead of the button appearing/disappearing. */
  disabled?: boolean;
  onStatusChange: (id: string, status: AgentStatus) => void;
  /** Fired only when every agent succeeded — deliberately not on a partial
   *  failure, so the failed rows stay selected for a retry. */
  onCompleted?: () => void;
}

interface RowResult {
  status: "success" | "error";
  message?: string;
}

/** Everything that differs between stopping and resuming. The two flows are
 *  otherwise identical — same confirm-and-fire, same retry semantics — so they
 *  share one component rather than two near-copies. */
const MODE_COPY = {
  stop: {
    action: "Stop",
    triggerVariant: "outline",
    confirmVariant: "destructive",
    rowSuccess: "Stopped",
    description:
      "This denies each agent's next proxy request immediately — in-flight work drains, new requests are refused.",
  },
  resume: {
    action: "Resume",
    // Green, matching the "Active" status badge — resuming is what puts an
    // agent back into that state. Tinted rather than solid so it sits level
    // with its Delete/Stop siblings in the toolbar.
    triggerVariant: "okOutline",
    confirmVariant: "okOutline",
    rowSuccess: "Resumed",
    description:
      "This restores each agent to active — its next proxy request will be evaluated normally again.",
  },
} as const;

/**
 * Batch stop/resume. Authorization is the signed-in session + org membership
 * (the api gates every /v1/* route and scopes to the caller's org), so there's
 * no per-agent token to collect anymore — this is a plain confirm dialog.
 * Agents that error are reported per-row and stay selected for a retry.
 */
export function BatchStopDialog({
  agents,
  mode,
  freezeAgent,
  unfreezeAgent,
  disabled = false,
  onStatusChange,
  onCompleted,
}: BatchStopDialogProps) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [results, setResults] = useState<Record<string, RowResult>>({});

  const copy = MODE_COPY[mode];

  function handleOpenChange(next: boolean) {
    // Belt-and-braces: the disabled trigger already can't be clicked, but guard
    // the state too so nothing (e.g. a keyboard path) can open an empty dialog.
    if (next && disabled) return;
    setOpen(next);
    if (!next) {
      setTimeout(() => setResults({}), 150);
    }
  }

  async function handleConfirm() {
    setPending(true);
    // Carry forward prior successes so retrying only re-attempts what
    // actually still needs it.
    const nextResults: Record<string, RowResult> = { ...results };

    for (const agent of agents) {
      if (nextResults[agent.id]?.status === "success") continue;
      try {
        // "Stop" always maps to a soft freeze under the hood — the backend
        // still models soft vs. hard separately, but the UI no longer exposes
        // that choice.
        const result =
          mode === "stop"
            ? await freezeAgent(agent.id, "soft")
            : await unfreezeAgent(agent.id);
        if (result.status !== undefined) onStatusChange(agent.id, result.status);
        nextResults[agent.id] = { status: "success" };
      } catch (err) {
        nextResults[agent.id] = {
          status: "error",
          message: err instanceof ApiError ? err.message : "Request failed",
        };
      }
    }

    setResults(nextResults);
    setPending(false);

    const allSucceeded = agents.every((agent) => nextResults[agent.id]?.status === "success");
    if (allSucceeded) {
      setOpen(false);
      onCompleted?.();
    }
  }

  const anyResults = Object.keys(results).length > 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button variant={copy.triggerVariant} size="sm" disabled={disabled} />}>
        {copy.action}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {copy.action} {agents.length} agent{agents.length === 1 ? "" : "s"}
          </DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>

        <div className="flex max-h-72 flex-col gap-2 overflow-y-auto">
          {agents.map((agent) => {
            const result = results[agent.id];
            return (
              <div
                key={agent.id}
                className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
                style={{ borderColor: "var(--line)" }}
              >
                <span className="truncate text-sm">{agent.name}</span>
                {result?.status === "success" && (
                  <span className="shrink-0 text-xs" style={{ color: "var(--ok)" }}>
                    {copy.rowSuccess}
                  </span>
                )}
                {result?.status === "error" && (
                  <span className="shrink-0 text-xs" style={{ color: "var(--err)" }}>
                    {result.message}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            {anyResults ? "Close" : "Cancel"}
          </DialogClose>
          <Button
            variant={copy.confirmVariant}
            onClick={handleConfirm}
            disabled={pending || agents.length === 0}
          >
            {pending ? "Working…" : copy.action}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

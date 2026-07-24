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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, freezeAgent, unfreezeAgent } from "@/lib/api";

type BatchStopMode = "stop" | "resume";

interface BatchStopDialogProps {
  agents: { id: string; name: string }[];
  mode: BatchStopMode;
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
 *  otherwise identical — same per-agent token prompt, same retry semantics —
 *  so they share one component rather than two near-copies. */
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
    triggerVariant: "default",
    confirmVariant: "default",
    rowSuccess: "Resumed",
    description:
      "This restores each agent to active — its next proxy request will be evaluated normally again.",
  },
} as const;

/**
 * There is no master/admin credential — each agent's OWN token is required.
 * Batching here only means "ask for every token up front and fire the requests
 * in one pass"; it does not skip or weaken the per-agent auth check in any way.
 */
export function BatchStopDialog({
  agents,
  mode,
  disabled = false,
  onStatusChange,
  onCompleted,
}: BatchStopDialogProps) {
  const [open, setOpen] = useState(false);
  const [tokens, setTokens] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [results, setResults] = useState<Record<string, RowResult>>({});

  const copy = MODE_COPY[mode];

  function handleOpenChange(next: boolean) {
    // Belt-and-braces: the disabled trigger already can't be clicked, but guard
    // the state too so nothing (e.g. a keyboard path) can open an empty dialog.
    if (next && disabled) return;
    setOpen(next);
    if (!next) {
      setTimeout(() => {
        setTokens({});
        setResults({});
      }, 150);
    }
  }

  async function handleConfirm() {
    setPending(true);
    // Carry forward prior successes so retrying only re-attempts what
    // actually still needs it.
    const nextResults: Record<string, RowResult> = { ...results };

    for (const agent of agents) {
      if (nextResults[agent.id]?.status === "success") continue;

      const token = (tokens[agent.id] ?? "").trim();
      if (token === "") {
        nextResults[agent.id] = { status: "error", message: "No token entered" };
        continue;
      }
      try {
        // "Stop" always maps to a soft freeze under the hood — the backend
        // still models soft vs. hard separately, but the UI no longer exposes
        // that choice.
        const result =
          mode === "stop"
            ? await freezeAgent(agent.id, "soft", token)
            : await unfreezeAgent(agent.id, token);
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
          <DialogDescription>
            {copy.description} Each agent&apos;s own token is required — there&apos;s no
            master key. Paste each one below; agents left blank are skipped and
            reported, not silently changed.
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-72 flex-col gap-3 overflow-y-auto">
          {agents.map((agent) => {
            const result = results[agent.id];
            const succeeded = result?.status === "success";
            return (
              <div key={agent.id} className="flex flex-col gap-1.5">
                <Label htmlFor={`batch-${mode}-token-${agent.id}`}>{agent.name}</Label>
                <Input
                  id={`batch-${mode}-token-${agent.id}`}
                  type="password"
                  autoComplete="off"
                  value={tokens[agent.id] ?? ""}
                  onChange={(e) =>
                    setTokens((prev) => ({ ...prev, [agent.id]: e.target.value }))
                  }
                  placeholder="tg_..."
                  disabled={succeeded}
                />
                {succeeded && (
                  <p className="text-xs" style={{ color: "var(--ok)" }}>
                    {copy.rowSuccess}
                  </p>
                )}
                {result?.status === "error" && (
                  <p className="text-xs" style={{ color: "var(--err)" }}>
                    {result.message}
                  </p>
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

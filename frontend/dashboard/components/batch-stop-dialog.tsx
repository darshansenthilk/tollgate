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
import { ApiError, freezeAgent } from "@/lib/api";

interface BatchStopDialogProps {
  agents: { id: string; name: string }[];
  onStatusChange: (id: string, status: AgentStatus) => void;
}

interface RowResult {
  status: "success" | "error";
  message?: string;
}

/**
 * There is no master/admin credential — each agent's OWN token is required,
 * same as the single-agent StopAgentButton. Batching here only means "ask
 * for every token up front and fire the requests in one pass"; it does not
 * skip or weaken the per-agent auth check in any way.
 */
export function BatchStopDialog({ agents, onStatusChange }: BatchStopDialogProps) {
  const [open, setOpen] = useState(false);
  const [tokens, setTokens] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [results, setResults] = useState<Record<string, RowResult>>({});

  function handleOpenChange(next: boolean) {
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
        const result = await freezeAgent(agent.id, "soft", token);
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
    if (allSucceeded) setOpen(false);
  }

  const anyResults = Object.keys(results).length > 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        Stop
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Stop {agents.length} agent{agents.length === 1 ? "" : "s"}
          </DialogTitle>
          <DialogDescription>
            Each agent&apos;s own token is required — there&apos;s no master
            key. Paste each one below; agents left blank are skipped and
            reported, not silently stopped.
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-72 flex-col gap-3 overflow-y-auto">
          {agents.map((agent) => {
            const result = results[agent.id];
            const succeeded = result?.status === "success";
            return (
              <div key={agent.id} className="flex flex-col gap-1.5">
                <Label htmlFor={`batch-stop-token-${agent.id}`}>{agent.name}</Label>
                <Input
                  id={`batch-stop-token-${agent.id}`}
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
                    Stopped
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
            variant="destructive"
            onClick={handleConfirm}
            disabled={pending || agents.length === 0}
          >
            {pending ? "Working…" : "Stop"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

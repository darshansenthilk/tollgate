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

const STOPPED_STATUSES: ReadonlySet<AgentStatus> = new Set<AgentStatus>([
  "soft_frozen",
  "hard_frozen",
]);

interface StopAgentButtonProps {
  agentId: string;
  agentName: string;
  status: AgentStatus;
  onStatusChange: (status: AgentStatus) => void;
}

export function StopAgentButton({
  agentId,
  agentName,
  status,
  onStatusChange,
}: StopAgentButtonProps) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === "archived") return null;

  const isStopped = STOPPED_STATUSES.has(status);
  const action = isStopped ? "Resume" : "Stop";

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      // Reset after the close animation so the dialog doesn't flash blank,
      // and so a pasted token doesn't linger in state after closing.
      setTimeout(() => {
        setToken("");
        setError(null);
      }, 150);
    }
  }

  async function handleConfirm() {
    setPending(true);
    setError(null);
    try {
      // "Stop" always maps to a soft freeze under the hood — the backend
      // still models soft vs. hard separately, but the UI no longer exposes
      // that choice; see the AgentStatus doc comment in
      // backend/shared/src/index.ts for what soft_frozen actually means.
      const result = isStopped
        ? await unfreezeAgent(agentId, token)
        : await freezeAgent(agentId, "soft", token);
      if (result.status !== undefined) onStatusChange(result.status);
      setOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Request failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button variant={isStopped ? "default" : "outline"} size="sm" />
        }
      >
        {action}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {action} {agentName}?
          </DialogTitle>
          <DialogDescription>
            {isStopped
              ? "This restores the agent to active — its next proxy request will be evaluated normally again."
              : "This denies the agent's next proxy request immediately — in-flight work drains, new requests are refused."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="stop-token">Agent token</Label>
          <Input
            id="stop-token"
            type="password"
            autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="tg_..."
            required
          />
          <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
            Sent as an <code>Authorization: Bearer</code> header and checked
            against this agent&apos;s token — you must hold it to {action.toLowerCase()} the agent.
          </p>
        </div>

        {error !== null && (
          <p className="text-sm" style={{ color: "var(--err)" }}>
            {error}
          </p>
        )}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button
            variant={isStopped ? "default" : "destructive"}
            onClick={handleConfirm}
            disabled={pending || token.trim() === ""}
          >
            {pending ? "Working…" : action}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

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
import { ApiError, freezeAgent, unfreezeAgent } from "@/lib/api";

const FROZEN_STATUSES: ReadonlySet<AgentStatus> = new Set<AgentStatus>([
  "soft_frozen",
  "hard_frozen",
]);

interface FreezeAgentButtonProps {
  agentId: string;
  agentName: string;
  status: AgentStatus;
  onStatusChange: (status: AgentStatus) => void;
}

export function FreezeAgentButton({
  agentId,
  agentName,
  status,
  onStatusChange,
}: FreezeAgentButtonProps) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === "archived") return null;

  const isFrozen = FROZEN_STATUSES.has(status);
  const action = isFrozen ? "Unfreeze" : "Freeze";

  async function handleConfirm() {
    setPending(true);
    setError(null);
    try {
      // The primary Freeze action always does a "soft" freeze — graceful
      // drain, reversible via unfreeze. Hard-freeze isn't exposed in this UI.
      const result = isFrozen
        ? await unfreezeAgent(agentId)
        : await freezeAgent(agentId, "soft");
      if (result.status !== undefined) onStatusChange(result.status);
      setOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Request failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant={isFrozen ? "default" : "outline"} size="sm" />
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
            {isFrozen
              ? "This restores the agent to active — its next proxy request will be evaluated normally again."
              : "This denies the agent's next proxy request immediately (soft freeze: in-flight work drains, new requests are refused)."}
          </DialogDescription>
        </DialogHeader>
        {error !== null && (
          <p className="text-sm" style={{ color: "var(--err)" }}>
            {error}
          </p>
        )}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button
            variant={isFrozen ? "default" : "destructive"}
            onClick={handleConfirm}
            disabled={pending}
          >
            {pending ? "Working…" : action}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

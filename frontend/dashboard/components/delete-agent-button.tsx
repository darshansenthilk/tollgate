"use client";

import { useState } from "react";
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
import { ApiError, deleteAgent } from "@/lib/api";

interface DeleteAgentButtonProps {
  agentId: string;
  agentName: string;
  onDeleted: (id: string) => void;
}

export function DeleteAgentButton({ agentId, agentName, onDeleted }: DeleteAgentButtonProps) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setTimeout(() => setError(null), 150);
    }
  }

  async function handleConfirm() {
    setPending(true);
    setError(null);
    try {
      await deleteAgent(agentId);
      onDeleted(agentId);
      setOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Request failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button variant="destructive" size="sm" />}>
        Delete
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {agentName}?</DialogTitle>
          <DialogDescription>
            This permanently removes the agent and revokes its token. This
            can&apos;t be undone.
          </DialogDescription>
        </DialogHeader>

        {error !== null && (
          <p className="text-sm" style={{ color: "var(--err)" }}>
            {error}
          </p>
        )}

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button variant="destructive" onClick={handleConfirm} disabled={pending}>
            {pending ? "Working…" : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

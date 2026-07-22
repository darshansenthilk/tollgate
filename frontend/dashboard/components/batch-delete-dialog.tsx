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

interface BatchDeleteDialogProps {
  agents: { id: string; name: string }[];
  onDeleted: (ids: string[]) => void;
}

/**
 * Deletes each selected agent independently (Promise.allSettled, not
 * all-or-nothing) — one bad id shouldn't block the rest from being removed.
 * Failures stay listed and selected so the toolbar's count reflects what's
 * actually left to retry.
 */
export function BatchDeleteDialog({ agents, onDeleted }: BatchDeleteDialogProps) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [failures, setFailures] = useState<{ name: string; message: string }[]>([]);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setTimeout(() => setFailures([]), 150);
    }
  }

  async function handleConfirm() {
    setPending(true);
    setFailures([]);

    const results = await Promise.allSettled(agents.map((agent) => deleteAgent(agent.id)));

    // Promise.allSettled preserves input order, so results[i] pairs with
    // agents[i] positionally.
    const succeededIds: string[] = [];
    const newFailures: { name: string; message: string }[] = [];
    results.forEach((result, i) => {
      const agent = agents[i];
      if (agent === undefined) return;
      if (result.status === "fulfilled") {
        succeededIds.push(agent.id);
      } else {
        const message =
          result.reason instanceof ApiError ? result.reason.message : "Request failed";
        newFailures.push({ name: agent.name, message });
      }
    });

    if (succeededIds.length > 0) onDeleted(succeededIds);
    setPending(false);

    if (newFailures.length > 0) {
      setFailures(newFailures);
    } else {
      setOpen(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button variant="destructive" size="sm" />}>
        Delete
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Delete {agents.length} agent{agents.length === 1 ? "" : "s"}?
          </DialogTitle>
          <DialogDescription>
            This permanently removes each selected agent and revokes its
            token. This can&apos;t be undone.
          </DialogDescription>
        </DialogHeader>

        <ul className="max-h-40 list-inside list-disc overflow-y-auto text-sm">
          {agents.map((agent) => (
            <li key={agent.id} style={{ color: "var(--muted-foreground)" }}>
              {agent.name}
            </li>
          ))}
        </ul>

        {failures.length > 0 && (
          <div className="text-sm" style={{ color: "var(--err)" }}>
            <p className="font-medium">
              Failed to delete {failures.length}:
            </p>
            <ul className="list-inside list-disc">
              {failures.map((f, i) => (
                <li key={`${f.name}-${i}`}>
                  {f.name}: {f.message}
                </li>
              ))}
            </ul>
          </div>
        )}

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            {failures.length > 0 ? "Close" : "Cancel"}
          </DialogClose>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={pending || agents.length === 0}
          >
            {pending ? "Working…" : `Delete ${agents.length}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

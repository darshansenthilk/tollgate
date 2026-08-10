"use client";

import { useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api";

const MAX_NAME_LENGTH = 50;

interface RenameDashboardDialogProps {
  open: boolean;
  /** The live name, straight from the active dashboard. Also the dirty-check
   *  baseline, so reopening after a save starts clean. */
  currentName: string;
  /** Injected for the same reason EditAgentDialog takes updateAgent — the
   *  dialog stays decoupled from lib/api and from who owns the state. */
  renameDashboard: (name: string) => Promise<void>;
  onOpenChange: (open: boolean) => void;
}

export function RenameDashboardDialog({
  open,
  currentName,
  renameDashboard,
  onOpenChange,
}: RenameDashboardDialogProps) {
  const [name, setName] = useState(currentName);
  const [seeded, setSeeded] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Identifies the current save. Nothing cancels the fetch itself, so this is
   *  how a settled-but-abandoned rename knows to drop its result instead of
   *  writing into a dialog that has since been dismissed or reopened. */
  const submissionId = useRef(0);

  // React's "adjusting state when a prop changes" pattern, keyed on the open
  // transition rather than on currentName. Reseeding whenever currentName
  // changed would wipe an in-progress edit the moment a rename landed
  // elsewhere; keying on open means the field is only ever refilled when the
  // dialog is actually reopened.
  if (open && !seeded) {
    setSeeded(true);
    setName(currentName);
    setError(null);
    // pending too: the dialog stays mounted when closed, so a rename still
    // in flight when the user dismissed would otherwise leave a reopened —
    // and visually clean — form with a disabled "Saving…" button.
    setPending(false);
  } else if (!open && seeded) {
    setSeeded(false);
    // Abandon any in-flight save's UI effects (see submissionId): dismissing
    // means the user walked away from it, so it must not later force-close or
    // paint an error into a dialog they've since reopened.
    submissionId.current += 1;
  }

  const trimmedName = name.trim();
  const isDirty = trimmedName !== "" && trimmedName !== currentName;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const id = submissionId.current + 1;
    submissionId.current = id;
    setPending(true);
    setError(null);
    try {
      await renameDashboard(trimmedName);
      if (submissionId.current !== id) return;
      onOpenChange(false);
    } catch (err) {
      if (submissionId.current !== id) return;
      setError(err instanceof ApiError ? err.message : "Request failed");
    } finally {
      if (submissionId.current === id) setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            {/* Two separate block-level lines rather than one wrapping string —
                a short name would otherwise sit inline right after "Rename
                dashboard" while only a long one wrapped, so the quoted name's
                line position depended on its length. Splitting into two spans
                forces the name onto its own line regardless of how short it is. */}
            <DialogTitle className="flex flex-col gap-1">
              <span>Rename dashboard</span>
              <span>&quot;{currentName}&quot;</span>
            </DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rename-dashboard-name">Name</Label>
            <Input
              id="rename-dashboard-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Platform team"
              required
              maxLength={MAX_NAME_LENGTH}
            />
            <p className="text-right text-xs text-muted-foreground">
              {name.length}/{MAX_NAME_LENGTH}
            </p>
          </div>

          {error !== null && (
            <p className="text-sm" style={{ color: "var(--err)" }}>
              {error}
            </p>
          )}

          <DialogFooter>
            <Button type="submit" disabled={pending || !isDirty}>
              {pending ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useRef, useState } from "react";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import {
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, type DashboardListItem } from "@/lib/api";

interface DeleteDashboardDialogProps {
  /** The dashboard being deleted, or null when nothing is. Mounted ONCE by the
   *  grid and driven by this, rather than one dialog per tile — Base UI dialogs
   *  cost ~60-110ms to mount, which components/agent-dashboard.tsx documents
   *  after paying it. */
  dashboard: DashboardListItem | null;
  /** Injected like RenameDashboardDialog's renameDashboard and
   *  BatchDeleteDialog's onConfirm: the dialog never touches lib/api itself. */
  deleteDashboard: (id: string) => Promise<void>;
  onOpenChange: (open: boolean) => void;
}

/**
 * Type-the-name confirmation for deleting a dashboard that still holds agents.
 *
 * An EMPTY dashboard never gets here at all — the grid deletes it outright, with
 * no dialog and no warning, because there is nothing to lose. So the copy is
 * three parts, of which only the middle one is conditional:
 *   1. in the header, always: the question, with the TOTAL non-archived count
 *      brand-coloured;
 *   2. in the header, ONLY when liveAgentCount > 0: a red warning naming the
 *      count that can still spend;
 *   3. BELOW THE INPUT, always: a smaller grey note that deleting revokes
 *      tokens. It sits after the type-to-confirm field rather than with the
 *      other two because it's a standing consequence of confirming, not part of
 *      the question being asked.
 *
 * Line 2 says "active", which is the user's word and NOT the same thing as the
 * `active` AgentStatus: the number behind it is liveAgentCount, which the api
 * defines as status IN ('active','pending'), the complement of the proxy's
 * FROZEN_STATUSES. Don't narrow the query to match the noun.
 *
 * The count is brand-coloured, which is the whole reason line 1 is JSX rather
 * than a string: the number is the fact the user has to register before typing
 * the name.
 *
 * NOTE — this copy was rewritten by the user on 2026-08-03 with the dialog in
 * front of them, over two rounds. It supersedes D3's "the escalated variant
 * shows both numbers": both variants now lead with the same total-count
 * question, and the running count moved into line 2. D1's "the copy says the
 * tokens stop working" is satisfied by line 3, which is now shown for an
 * all-frozen dashboard too rather than only for a live one.
 *
 * AlertDialog rather than Dialog: it forces role="alertdialog" and drops
 * dismiss-on-outside-click, so a half-typed name can't be lost to a stray
 * backdrop click. Base UI's alert-dialog Popup/Backdrop/Title/Description/Close
 * are literally the same components dialog exports, so ui/dialog.tsx's wrappers
 * work unchanged inside it.
 */
export function DeleteDashboardDialog({
  dashboard,
  deleteDashboard,
  onOpenChange,
}: DeleteDashboardDialogProps) {
  const [typedName, setTypedName] = useState("");
  const [seeded, setSeeded] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Identifies the current delete. Nothing cancels the fetch, so this is how a
   *  settled-but-abandoned request knows to drop its result rather than write
   *  into a dialog that has since been dismissed or reopened for a DIFFERENT
   *  dashboard — the same guard rename-dashboard-dialog.tsx carries. */
  const submissionId = useRef(0);

  const open = dashboard !== null;

  // React's "adjusting state when a prop changes" pattern, keyed on the open
  // transition (see RenameDashboardDialog for the full reasoning).
  if (open && !seeded) {
    setSeeded(true);
    setTypedName("");
    setError(null);
    // pending too: the dialog stays mounted when closed, so a delete still in
    // flight when the user dismissed would otherwise leave a reopened — and
    // visually clean — form stuck on a disabled "Deleting…" button.
    setPending(false);
  } else if (!open && seeded) {
    setSeeded(false);
    submissionId.current += 1;
  }

  // Exact match, trimmed only at the ends so trailing whitespace isn't a
  // mystifying near-miss. Deliberately case-sensitive: the whole point is that
  // the user reads the name off the tile rather than pattern-matching it.
  const confirmed = dashboard !== null && typedName.trim() === dashboard.name;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (dashboard === null || !confirmed) return;
    const id = submissionId.current + 1;
    submissionId.current = id;
    setPending(true);
    setError(null);
    try {
      await deleteDashboard(dashboard.id);
      if (submissionId.current !== id) return;
      onOpenChange(false);
    } catch (err) {
      if (submissionId.current !== id) return;
      setError(err instanceof ApiError ? err.message : "Request failed");
    } finally {
      if (submissionId.current === id) setPending(false);
    }
  }

  const agentCount = dashboard?.agentCount ?? 0;
  const liveCount = dashboard?.liveAgentCount ?? 0;
  const agentWord = agentCount === 1 ? "agent" : "agents";

  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Delete {dashboard?.name ?? "dashboard"}?</DialogTitle>
            {/* text-foreground overrides DialogDescription's muted default, so
                the three lines read as a hierarchy: the question in normal text,
                the live-agent warning in red, the standing note in grey. Without
                it the question and the note are the same colour and the note
                stops reading as secondary. */}
            <DialogDescription className="text-foreground">
              Are you sure you would like to remove this dashboard with{" "}
              <span className="text-brand">
                {agentCount} {agentWord}
              </span>
              ?
            </DialogDescription>
            {/* Only when something can still spend. Rendered as a SIBLING of the
                description rather than inside it: DialogDescription is a <p>,
                and nesting a second paragraph in it would be invalid HTML.
                DialogHeader is a flex column with gap-2, so siblings stack. */}
            {liveCount > 0 && (
              <p className="text-sm" style={{ color: "var(--err)" }}>
                Warning: {liveCount} {liveCount === 1 ? "agent is" : "agents are"} currently
                active.
              </p>
            )}
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="delete-dashboard-name">
              Type <span className="font-medium text-foreground">{dashboard?.name}</span> to
              confirm
            </Label>
            <Input
              id="delete-dashboard-name"
              value={typedName}
              onChange={(e) => setTypedName(e.target.value)}
              autoComplete="off"
            />
          </div>

          {/* Sits below the input rather than up in the header: it's a standing
              consequence of confirming, so it reads last, next to the button
              that acts on it. text-xs (12px) rather than the text-sm (14px) the
              lines above use, so it settles into the background as a footnote. */}
          <p className="text-xs text-muted-foreground">
            Note: Deleting agents revokes their tokens, and they will start failing on
            the next request.
          </p>

          {error !== null && (
            <p className="text-sm" style={{ color: "var(--err)" }}>
              {error}
            </p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={pending || !confirmed}>
              {pending ? "Deleting…" : "Delete dashboard"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </AlertDialog.Root>
  );
}

"use client";

import type { AgentStatus } from "@tollgate/shared";
import { BatchStopDialog } from "@/components/batch-stop-dialog";
import { BatchDeleteDialog } from "@/components/batch-delete-dialog";
import { isStopped } from "@/lib/agent-status";

interface SelectionToolbarProps {
  selectedAgents: { id: string; name: string; status: AgentStatus }[];
  onDeleted: (ids: string[]) => void;
  onStatusChange: (id: string, status: AgentStatus) => void;
  /** Fired when a batch action fully succeeds — drives the auto-exit out of
   *  selection mode. */
  onCompleted?: () => void;
}

export function SelectionToolbar({
  selectedAgents,
  onDeleted,
  onStatusChange,
  onCompleted,
}: SelectionToolbarProps) {
  // Split the selection so each dialog only ever prompts for tokens it can
  // actually use. Archived agents belong to neither — same guard the per-row
  // button used to apply. The buttons are always rendered (the bar is a fixed
  // part of selection mode) and simply disabled — greyed and unclickable —
  // when their subset is empty, so the toolbar never changes shape.
  const stoppable = selectedAgents.filter(
    (a) => !isStopped(a.status) && a.status !== "archived",
  );
  const resumable = selectedAgents.filter((a) => isStopped(a.status));

  return (
    <div className="mb-3 flex items-center justify-between rounded-lg border bg-muted/50 px-4 py-2.5 text-sm">
      <span>
        {selectedAgents.length} agent{selectedAgents.length === 1 ? "" : "s"} selected
      </span>
      <div className="flex items-center gap-2">
        <BatchStopDialog
          mode="stop"
          agents={stoppable}
          disabled={stoppable.length === 0}
          onStatusChange={onStatusChange}
          onCompleted={onCompleted}
        />
        <BatchStopDialog
          mode="resume"
          agents={resumable}
          disabled={resumable.length === 0}
          onStatusChange={onStatusChange}
          onCompleted={onCompleted}
        />
        <BatchDeleteDialog
          agents={selectedAgents}
          disabled={selectedAgents.length === 0}
          onDeleted={onDeleted}
          onCompleted={onCompleted}
        />
      </div>
    </div>
  );
}

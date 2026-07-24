"use client";

import type { AgentStatus } from "@tollgate/shared";
import { Button } from "@/components/ui/button";
import { BatchStopDialog } from "@/components/batch-stop-dialog";
import { BatchDeleteDialog } from "@/components/batch-delete-dialog";
import { isStopped } from "@/lib/agent-status";

interface SelectionToolbarProps {
  selectedAgents: { id: string; name: string; status: AgentStatus }[];
  onDeleted: (ids: string[]) => void;
  onStatusChange: (id: string, status: AgentStatus) => void;
  onClearSelection: () => void;
  /** Fired when a batch action fully succeeds — drives the auto-exit out of
   *  selection mode. */
  onCompleted?: () => void;
}

export function SelectionToolbar({
  selectedAgents,
  onDeleted,
  onStatusChange,
  onClearSelection,
  onCompleted,
}: SelectionToolbarProps) {
  // Split the selection so each dialog only ever prompts for tokens it can
  // actually use. Archived agents belong to neither — same guard the per-row
  // button used to apply.
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
        <Button type="button" variant="ghost" size="sm" onClick={onClearSelection}>
          Clear
        </Button>
        {stoppable.length > 0 && (
          <BatchStopDialog
            mode="stop"
            agents={stoppable}
            onStatusChange={onStatusChange}
            onCompleted={onCompleted}
          />
        )}
        {resumable.length > 0 && (
          <BatchStopDialog
            mode="resume"
            agents={resumable}
            onStatusChange={onStatusChange}
            onCompleted={onCompleted}
          />
        )}
        <BatchDeleteDialog
          agents={selectedAgents}
          onDeleted={onDeleted}
          onCompleted={onCompleted}
        />
      </div>
    </div>
  );
}

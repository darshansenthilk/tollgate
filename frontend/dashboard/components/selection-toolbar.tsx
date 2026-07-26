"use client";

import type { AgentStatus } from "@tollgate/shared";
import { BatchStopDialog } from "@/components/batch-stop-dialog";
import { BatchDeleteDialog } from "@/components/batch-delete-dialog";
import { isStopped } from "@/lib/agent-status";
import type { AgentMutationResponse } from "@/lib/api";

interface SelectionToolbarProps {
  selectedAgents: { id: string; name: string; status: AgentStatus }[];
  /** Pure pass-through to the three dialogs below — see their own prop docs
   *  for why these are injected rather than imported from lib/api.ts. */
  freezeAgent: (id: string, mode: "soft" | "hard") => Promise<AgentMutationResponse>;
  unfreezeAgent: (id: string) => Promise<AgentMutationResponse>;
  deleteAgent: (id: string) => Promise<AgentMutationResponse>;
  onDeleted: (ids: string[]) => void;
  onStatusChange: (id: string, status: AgentStatus) => void;
  /** Fired when a batch action fully succeeds — drives the auto-exit out of
   *  selection mode. */
  onCompleted?: () => void;
}

export function SelectionToolbar({
  selectedAgents,
  freezeAgent,
  unfreezeAgent,
  deleteAgent,
  onDeleted,
  onStatusChange,
  onCompleted,
}: SelectionToolbarProps) {
  // Split the selection so each dialog only ever offers agents it's eligible
  // to act on. Archived agents belong to neither — same guard the per-row
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
          freezeAgent={freezeAgent}
          unfreezeAgent={unfreezeAgent}
          disabled={stoppable.length === 0}
          onStatusChange={onStatusChange}
          onCompleted={onCompleted}
        />
        <BatchStopDialog
          mode="resume"
          agents={resumable}
          freezeAgent={freezeAgent}
          unfreezeAgent={unfreezeAgent}
          disabled={resumable.length === 0}
          onStatusChange={onStatusChange}
          onCompleted={onCompleted}
        />
        <BatchDeleteDialog
          agents={selectedAgents}
          deleteAgent={deleteAgent}
          disabled={selectedAgents.length === 0}
          onDeleted={onDeleted}
          onCompleted={onCompleted}
        />
      </div>
    </div>
  );
}

"use client";

import type { AgentStatus } from "@tollgate/shared";
import { Button } from "@/components/ui/button";
import { BatchStopDialog } from "@/components/batch-stop-dialog";
import { BatchDeleteDialog } from "@/components/batch-delete-dialog";

interface SelectionToolbarProps {
  selectedAgents: { id: string; name: string }[];
  onDeleted: (ids: string[]) => void;
  onStatusChange: (id: string, status: AgentStatus) => void;
  onClearSelection: () => void;
}

export function SelectionToolbar({
  selectedAgents,
  onDeleted,
  onStatusChange,
  onClearSelection,
}: SelectionToolbarProps) {
  return (
    <div className="mb-3 flex items-center justify-between rounded-lg border bg-muted/50 px-4 py-2.5 text-sm">
      <span>
        {selectedAgents.length} agent{selectedAgents.length === 1 ? "" : "s"} selected
      </span>
      <div className="flex items-center gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onClearSelection}>
          Clear
        </Button>
        <BatchStopDialog agents={selectedAgents} onStatusChange={onStatusChange} />
        <BatchDeleteDialog agents={selectedAgents} onDeleted={onDeleted} />
      </div>
    </div>
  );
}

"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ConnectAgentSnippet } from "@/components/connect-agent-snippet";
import { providerLabel } from "@/lib/agent-options";
import type { AgentListItem } from "@/lib/api";

const PLACEHOLDER_TOKEN = "<YOUR_TOLLGATE_TOKEN>";

interface AgentIntegrationDialogProps {
  /** null = closed, matching EditAgentDialog's id-driven pattern (one dialog
   *  for the whole table, not one per row). */
  agent: AgentListItem | null;
  onOpenChange: (open: boolean) => void;
}

/**
 * Re-shows the same connect snippet as create-agent-dialog.tsx's success
 * view, but for an agent whose token was already shown once (and is not
 * recoverable — see lib/api.ts's CreateAgentResponse doc comment) — so this
 * always renders a placeholder in its place, never a real token.
 */
export function AgentIntegrationDialog({ agent, onOpenChange }: AgentIntegrationDialogProps) {
  return (
    <Dialog open={agent !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Connect {agent?.name}</DialogTitle>
          <DialogDescription>
            Point this agent&apos;s code at Tollgate instead of calling{" "}
            {providerLabel(agent?.providerSlug ?? "")} directly.
          </DialogDescription>
        </DialogHeader>

        <div
          className="rounded-lg border p-3"
          style={{ borderColor: "var(--line)" }}
        >
          <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
            Tokens are only ever shown once, at creation. Replace{" "}
            <code className="text-xs">{PLACEHOLDER_TOKEN}</code> below with the
            token you saved for this agent. If it&apos;s lost, delete this
            agent and create a new one — a token can&apos;t be recovered or
            re-issued for the same agent.
          </p>
        </div>

        {agent !== null && (
          <ConnectAgentSnippet
            providerSlug={agent.providerSlug}
            model={agent.model}
            token={PLACEHOLDER_TOKEN}
          />
        )}

        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

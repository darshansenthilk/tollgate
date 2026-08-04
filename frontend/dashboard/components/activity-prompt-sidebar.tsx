"use client";

import {
  Sidebar,
  SidebarContent,
  SidebarDescription,
  SidebarHeader,
  SidebarTitle,
} from "@/components/ui/sidebar";
import { providerLabel } from "@/lib/agent-options";
import type { ActivityEvent } from "@/lib/api";

/**
 * What one logged request actually asked for.
 *
 * The sibling AgentPromptSidebar shows an agent's LIVE prompt from Redis
 * (~2min TTL, gone once the agent goes idle); this one shows a specific past
 * event's, read from the spend_events row. Same shape on purpose — an
 * operator shouldn't have to learn two panels — but the sourcing differs, and
 * the copy below says so rather than letting them assume.
 */

interface ActivityPromptSidebarProps {
  /** null = closed. Looked up fresh from the polled events list each render —
   *  see the call site in activity-log.tsx. */
  event: ActivityEvent | null;
  onOpenChange: (open: boolean) => void;
}

/** Pretty-print the recorded body when it's JSON (every adapter forwards
 *  JSON), falling back to the raw text for a truncated or non-JSON one —
 *  the point is legibility, so a parse failure must not blank the panel. */
function formatPrompt(prompt: string): string {
  try {
    return JSON.stringify(JSON.parse(prompt), null, 2);
  } catch {
    return prompt;
  }
}

export function ActivityPromptSidebar({ event, onOpenChange }: ActivityPromptSidebarProps) {
  const prompt = event?.prompt ?? null;
  const hasPrompt = prompt !== null && prompt.trim() !== "";

  return (
    <Sidebar open={event !== null} onOpenChange={onOpenChange}>
      <SidebarContent>
        <SidebarHeader>
          <SidebarTitle>{event?.agentName ?? "Request"}</SidebarTitle>
          <SidebarDescription>
            {event === null
              ? null
              : `${providerLabel(event.assistant)} · ${event.endpoint} · ${new Date(
                  event.createdAt,
                ).toLocaleString()}`}
          </SidebarDescription>
        </SidebarHeader>

        {hasPrompt ? (
          <pre className="overflow-x-auto rounded-lg border bg-muted/50 p-3 text-xs break-words whitespace-pre-wrap">
            {formatPrompt(prompt)}
          </pre>
        ) : (
          <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
            {/* Two genuinely different "no prompt" cases, and conflating them
                would mislead: a pre-forward denial never had a body to record,
                while an operator decision isn't a request at all. */}
            {event !== null &&
            (event.decision === "approval_granted" || event.decision === "approval_denied")
              ? "This is an operator's decision on a blocked tool call, not a request an agent sent — so there's no prompt to show."
              : "Nothing was forwarded for this request, so no prompt was recorded."}
          </p>
        )}
      </SidebarContent>
    </Sidebar>
  );
}

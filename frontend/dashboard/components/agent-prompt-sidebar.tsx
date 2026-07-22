"use client";

import {
  Sidebar,
  SidebarContent,
  SidebarDescription,
  SidebarHeader,
  SidebarTitle,
} from "@/components/ui/sidebar";
import type { AgentListItem } from "@/lib/api";

interface AgentPromptSidebarProps {
  /** null = closed. Look this up fresh from the live (polled) agents list
   *  each render, not a snapshot taken when the row was clicked — otherwise
   *  currentPrompt would never reflect later polls (e.g. going back to null
   *  once the proxy's ~2min Redis TTL lapses). */
  agent: AgentListItem | null;
  onOpenChange: (open: boolean) => void;
}

export function AgentPromptSidebar({ agent, onOpenChange }: AgentPromptSidebarProps) {
  const hasPrompt = agent !== null && agent.currentPrompt !== null && agent.currentPrompt.trim() !== "";

  return (
    <Sidebar open={agent !== null} onOpenChange={onOpenChange}>
      <SidebarContent>
        <SidebarHeader>
          <SidebarTitle>{agent?.name ?? "Agent"}</SidebarTitle>
          <SidebarDescription>
            Current prompt — transient, kept in Redis for ~2 minutes by the
            proxy and never written to Postgres.
          </SidebarDescription>
        </SidebarHeader>

        {hasPrompt ? (
          <pre className="overflow-x-auto rounded-lg border bg-muted/50 p-3 text-xs break-words whitespace-pre-wrap">
            {agent.currentPrompt}
          </pre>
        ) : (
          <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
            No recent activity — nothing in flight for this agent right now.
          </p>
        )}
      </SidebarContent>
    </Sidebar>
  );
}

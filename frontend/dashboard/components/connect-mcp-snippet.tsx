"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { buildMcpConnectInfo } from "@/lib/agent-connect";

interface ConnectMcpSnippetProps {
  hostPlatform: string;
  token: string;
}

/**
 * The MCP-gateway counterpart to ConnectAgentSnippet: shown instead of an SDK
 * snippet for an externally-hosted agent, since Tollgate never sees that
 * agent's LLM traffic — only the tool calls it routes through the MCP
 * gateway once this URL is registered on the platform's own side.
 */
export function ConnectMcpSnippet({ hostPlatform, token }: ConnectMcpSnippetProps) {
  const [copiedField, setCopiedField] = useState<"url" | "token" | null>(null);

  const info = buildMcpConnectInfo(hostPlatform, token);
  if (info === null) return null;

  async function handleCopy(field: "url" | "token", value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      // Selectable/copyable by hand from the <code> block either way.
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium">Register as an MCP tool source</p>
      <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
        {info.instructions}
      </p>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs" style={{ color: "var(--muted-foreground)" }}>
          Server URL
        </span>
        <div className="flex items-center gap-2">
          <code className="flex-1 overflow-x-auto rounded-lg border bg-muted px-2.5 py-1.5 text-xs">
            {info.serverUrl}
          </code>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void handleCopy("url", info.serverUrl)}
          >
            {copiedField === "url" ? "Copied" : "Copy"}
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs" style={{ color: "var(--muted-foreground)" }}>
          Bearer token
        </span>
        <div className="flex items-center gap-2">
          <code className="flex-1 overflow-x-auto rounded-lg border bg-muted px-2.5 py-1.5 text-xs">
            {info.token}
          </code>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void handleCopy("token", info.token)}
          >
            {copiedField === "token" ? "Copied" : "Copy"}
          </Button>
        </div>
      </div>
    </div>
  );
}

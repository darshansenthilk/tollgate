"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { UpstreamKey } from "@/lib/api";

const NO_KEY = "__no_admin_key__";

export interface AnthropicLinkFieldsProps {
  /** Distinguishes element ids between the create dialog and the edit
   *  panel, which can both be mounted (rarely, but possible) at once. */
  idPrefix: string;
  apiKeyId: string;
  onApiKeyIdChange: (value: string) => void;
  workspaceId: string;
  onWorkspaceIdChange: (value: string) => void;
  sessionId: string;
  onSessionIdChange: (value: string) => void;
  upstreamKeyId: string | null;
  onUpstreamKeyIdChange: (value: string | null) => void;
  /** "anthropic-admin" keys the org has saved (Settings → Provider keys) —
   *  fetched once by whichever dialog renders this, not here. */
  adminKeyOptions: UpstreamKey[];
}

/**
 * Purely controlled — no fetch, no save button, no local state of its own.
 * Reused by both create-agent-dialog.tsx (folded straight into agent
 * creation, so linking an Anthropic Managed Agents agent is one step instead
 * of "create, then edit to configure the link") and anthropic-link-panel.tsx
 * (which wraps this with its own fetch/save/delete cycle for an
 * already-created agent).
 */
export function AnthropicLinkFields({
  idPrefix,
  apiKeyId,
  onApiKeyIdChange,
  workspaceId,
  onWorkspaceIdChange,
  sessionId,
  onSessionIdChange,
  upstreamKeyId,
  onUpstreamKeyIdChange,
  adminKeyOptions,
}: AnthropicLinkFieldsProps) {
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-api-key-id`}>Anthropic API key id</Label>
        <Input
          id={`${idPrefix}-api-key-id`}
          value={apiKeyId}
          onChange={(e) => onApiKeyIdChange(e.target.value)}
          placeholder="apikey_01Rj2N8SVvo6BePZj99NhmiT"
        />
        <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
          The real Anthropic API key this agent&apos;s Managed Agents session
          runs under — from the Claude Console, not a Tollgate token.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-workspace-id`}>Workspace id (optional)</Label>
        <Input
          id={`${idPrefix}-workspace-id`}
          value={workspaceId}
          onChange={(e) => onWorkspaceIdChange(e.target.value)}
          placeholder="wrkspc_01JwQvzr7rXLA5AGx3HKfFUJ"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-session-id`}>Session id (optional)</Label>
        <Input
          id={`${idPrefix}-session-id`}
          value={sessionId}
          onChange={(e) => onSessionIdChange(e.target.value)}
          placeholder="sess_..."
        />
        <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
          Only needed for native budget delegation — lets Tollgate keep this
          session&apos;s own spend cap in sync with this agent&apos;s budget,
          so Anthropic&apos;s own runtime pauses it when reached.
        </p>
      </div>

      {adminKeyOptions.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-admin-key`}>Admin API key</Label>
          <Select
            items={[
              { value: NO_KEY, label: "None selected" },
              ...adminKeyOptions.map((k) => ({ value: k.id, label: `${k.label} (${k.keyHint})` })),
            ]}
            value={upstreamKeyId ?? NO_KEY}
            onValueChange={(value) => onUpstreamKeyIdChange(value === NO_KEY ? null : value)}
          >
            <SelectTrigger id={`${idPrefix}-admin-key`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_KEY}>None selected</SelectItem>
              {adminKeyOptions.map((k) => (
                <SelectItem key={k.id} value={k.id}>
                  {k.label} ({k.keyHint})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : (
        <p className="text-xs" style={{ color: "var(--amber)" }}>
          No Anthropic Admin API key saved yet — add one under Settings →
          Provider keys first, then pick it here.
        </p>
      )}
    </>
  );
}

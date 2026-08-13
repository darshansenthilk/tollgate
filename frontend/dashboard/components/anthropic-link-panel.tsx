"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { AnthropicLinkFields } from "@/components/anthropic-link-fields";
import {
  ApiError,
  deleteAnthropicLink,
  getAnthropicLink,
  saveAnthropicLink,
  type UpstreamKey,
} from "@/lib/api";

interface AnthropicLinkPanelProps {
  agentId: string;
  /** "anthropic-admin" keys the org has saved (Settings → Upstream keys) —
   *  fetched once by the parent dialog alongside its own upstream-key list,
   *  not re-fetched here. */
  adminKeyOptions: UpstreamKey[];
}

/**
 * External agent governance, Phase 2/4: lets an operator point an
 * Anthropic-Managed-Agents-hosted agent at the real Anthropic identifiers
 * the usage/budget poller needs (connectors/poll-anthropic-links.ts) — which
 * stored Admin key to poll with, the real Anthropic API key id to filter
 * usage by, and (optional) a live session id for native budget delegation.
 *
 * For an already-created agent only — create-agent-dialog.tsx folds these
 * same fields (via AnthropicLinkFields) straight into agent creation, so
 * this panel is really for editing a link after the fact, or setting one up
 * for an agent that skipped it at creation. Its own fetch/save/delete cycle,
 * separate from the surrounding agent-edit form: this is a different
 * resource (anthropic_managed_agent_links), saved through a different route
 * (PUT /v1/agents/:id/anthropic-link).
 */
export function AnthropicLinkPanel({ agentId, adminKeyOptions }: AnthropicLinkPanelProps) {
  const [loading, setLoading] = useState(true);
  const [apiKeyId, setApiKeyId] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [upstreamKeyId, setUpstreamKeyId] = useState<string | null>(null);
  const [lastPolledAt, setLastPolledAt] = useState<string | null>(null);
  const [linked, setLinked] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void getAnthropicLink(agentId)
      .then((link) => {
        if (cancelled) return;
        if (link !== null) {
          setApiKeyId(link.anthropicApiKeyId);
          setWorkspaceId(link.anthropicWorkspaceId ?? "");
          setSessionId(link.currentSessionId ?? "");
          setUpstreamKeyId(link.upstreamKeyId);
          setLastPolledAt(link.lastPolledAt);
          setLinked(true);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Couldn't load the link.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [agentId]);

  async function handleSave() {
    setPending(true);
    setError(null);
    setSaved(false);
    try {
      if (apiKeyId.trim() === "") {
        setError("The real Anthropic API key id is required.");
        return;
      }
      await saveAnthropicLink(agentId, {
        anthropicApiKeyId: apiKeyId.trim(),
        anthropicWorkspaceId: workspaceId.trim() === "" ? null : workspaceId.trim(),
        currentSessionId: sessionId.trim() === "" ? null : sessionId.trim(),
        upstreamKeyId,
      });
      setLinked(true);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save the link.");
    } finally {
      setPending(false);
    }
  }

  async function handleRemove() {
    setPending(true);
    setError(null);
    try {
      await deleteAnthropicLink(agentId);
      setLinked(false);
      setApiKeyId("");
      setWorkspaceId("");
      setSessionId("");
      setUpstreamKeyId(null);
      setLastPolledAt(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't remove the link.");
    } finally {
      setPending(false);
    }
  }

  if (loading) {
    return (
      <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
        Loading Anthropic link…
      </p>
    );
  }

  return (
    <div
      className="flex flex-col gap-3 rounded-lg border p-3"
      style={{ borderColor: "var(--line)", background: "var(--panel)" }}
    >
      <div>
        <p className="text-sm font-medium">Anthropic Managed Agents link</p>
        <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
          Real usage syncs automatically every few minutes once this is
          saved — no separate setup needed.
        </p>
      </div>

      <AnthropicLinkFields
        idPrefix="anthropic-link"
        apiKeyId={apiKeyId}
        onApiKeyIdChange={setApiKeyId}
        workspaceId={workspaceId}
        onWorkspaceIdChange={setWorkspaceId}
        sessionId={sessionId}
        onSessionIdChange={setSessionId}
        upstreamKeyId={upstreamKeyId}
        onUpstreamKeyIdChange={setUpstreamKeyId}
        adminKeyOptions={adminKeyOptions}
      />

      {lastPolledAt !== null && (
        <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
          Last polled {new Date(lastPolledAt).toLocaleString()}.
        </p>
      )}

      {error !== null && (
        <p className="text-sm" style={{ color: "var(--err)" }}>
          {error}
        </p>
      )}

      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => void handleSave()}>
          {pending ? "Saving…" : saved ? "Saved" : linked ? "Update link" : "Save link"}
        </Button>
        {linked && (
          <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => void handleRemove()}>
            Remove link
          </Button>
        )}
      </div>
    </div>
  );
}

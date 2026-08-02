"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ApiError,
  listUpstreamKeys,
  saveUpstreamKey,
  deleteUpstreamKey,
  type UpstreamKeyProvider,
} from "@/lib/api";

/**
 * BYOK settings: the org supplies its own OpenAI/Anthropic/Gemini keys so its
 * agents' upstream usage bills to the org's provider account instead of
 * Tollgate's shared key.
 *
 * MULTI-KEY: an org can store several keys per provider (e.g. "Prod" and
 * "Jane's key"), each with its own label. Which key a given agent actually
 * forwards with is chosen on the agent itself (create/edit-agent-dialog), not
 * here — this page only manages the org's pool of stored keys.
 *
 * Two things this deliberately never does:
 *  - echo a saved key back (the api doesn't return one; only a "sk-…7mQ4" hint)
 *  - report success on a key the provider hasn't accepted — the api verifies
 *    against the real provider before storing, and a rejection surfaces here
 *    verbatim rather than as a generic error.
 */

type FormState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "error"; message: string };

type RemoveState = { kind: "idle" } | { kind: "removing" } | { kind: "error"; message: string };

function KeyRow({
  providerSlug,
  keyId,
  label,
  keyHint,
  onChanged,
}: {
  providerSlug: string;
  keyId: string;
  label: string;
  keyHint: string;
  onChanged: () => Promise<void>;
}) {
  const [state, setState] = useState<RemoveState>({ kind: "idle" });

  async function handleRemove() {
    setState({ kind: "removing" });
    try {
      await deleteUpstreamKey(keyId);
      await onChanged();
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof ApiError ? err.message : "Couldn't remove that key.",
      });
    }
  }

  return (
    <div className="flex flex-col gap-1 py-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-medium">{label}</span>
          <span className="font-mono text-xs" style={{ color: "var(--muted-foreground)" }}>
            {keyHint}
          </span>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleRemove}
          disabled={state.kind === "removing"}
        >
          {state.kind === "removing" ? "Removing…" : "Remove"}
        </Button>
      </div>
      {state.kind === "error" && (
        <p className="text-sm" style={{ color: "var(--err)" }}>
          {state.message}
        </p>
      )}
    </div>
  );
}

function AddKeyForm({
  providerSlug,
  onChanged,
}: {
  providerSlug: string;
  onChanged: () => Promise<void>;
}) {
  const [label, setLabel] = useState("");
  const [key, setKey] = useState("");
  const [state, setState] = useState<FormState>({ kind: "idle" });

  async function handleSave() {
    if (key.trim() === "") return;
    setState({ kind: "saving" });
    try {
      await saveUpstreamKey(providerSlug, key.trim(), label.trim() || undefined);
      // Clear immediately: the plaintext key should not linger in a form field
      // once it's stored, and it can never be shown again anyway.
      setKey("");
      setLabel("");
      setState({ kind: "idle" });
      await onChanged();
    } catch (err) {
      setState({
        kind: "error",
        // ApiError.message carries the provider's own rejection reason for a
        // key_rejected response — see lib/api.ts's request().
        message: err instanceof ApiError ? err.message : "Couldn't save that key.",
      });
    }
  }

  const saving = state.kind === "saving";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Input
          className="w-32"
          placeholder="Label (optional)"
          disabled={saving}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <Input
          // type=password so the key isn't shoulder-surfable while pasting, and
          // browsers don't offer to remember it as ordinary text.
          type="password"
          autoComplete="off"
          spellCheck={false}
          disabled={saving}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder={providerSlug === "claude" ? "sk-ant-…" : "sk-…"}
        />
        <Button type="button" onClick={handleSave} disabled={saving || key.trim() === ""}>
          {saving ? "Verifying…" : "Add key"}
        </Button>
      </div>
      {state.kind === "error" && (
        <p className="text-sm" style={{ color: "var(--err)" }}>
          {state.message}
        </p>
      )}
    </div>
  );
}

function ProviderSection({
  provider,
  onChanged,
}: {
  provider: UpstreamKeyProvider;
  onChanged: () => Promise<void>;
}) {
  return (
    <div className="flex flex-col gap-2 border-t py-4 first:border-t-0 first:pt-0">
      <div className="flex items-center justify-between gap-3">
        <Label>{provider.label}</Label>
        <span className="font-mono text-xs" style={{ color: "var(--muted-foreground)" }}>
          {provider.keys.length === 0
            ? "No keys set"
            : `${provider.keys.length} key${provider.keys.length === 1 ? "" : "s"}`}
        </span>
      </div>

      {provider.keys.length > 0 && (
        <div className="flex flex-col divide-y">
          {provider.keys.map((k) => (
            <KeyRow
              key={k.id}
              providerSlug={provider.slug}
              keyId={k.id}
              label={k.label}
              keyHint={k.keyHint}
              onChanged={onChanged}
            />
          ))}
        </div>
      )}

      <AddKeyForm providerSlug={provider.slug} onChanged={onChanged} />
    </div>
  );
}

export function UpstreamKeysSettings() {
  const [data, setData] = useState<
    { vaultConfigured: boolean; providers: UpstreamKeyProvider[] } | null
  >(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setData(await listUpstreamKeys());
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "Couldn't load key settings.");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (loadError !== null) {
    return (
      <p className="text-sm" style={{ color: "var(--err)" }}>
        {loadError}
      </p>
    );
  }

  if (data === null) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  return (
    <div className="flex flex-col">
      {!data.vaultConfigured && (
        <div
          className="mb-4 rounded-lg border p-3"
          style={{
            borderColor: "var(--amber)",
            background: "color-mix(in oklch, var(--amber) 10%, transparent)",
          }}
        >
          <p className="text-sm" style={{ color: "var(--amber)" }}>
            This deployment can&apos;t store provider keys yet — its
            VAULT_ENCRYPTION_KEY isn&apos;t configured. Saving will fail until an
            operator sets one.
          </p>
        </div>
      )}

      {data.providers.map((provider) => (
        <ProviderSection key={provider.slug} provider={provider} onChanged={refresh} />
      ))}
    </div>
  );
}

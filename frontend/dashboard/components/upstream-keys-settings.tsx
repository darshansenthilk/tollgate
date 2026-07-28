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
  type UpstreamKeyStatus,
} from "@/lib/api";

/**
 * BYOK settings: the org supplies its own OpenAI/Anthropic keys so its agents'
 * upstream usage bills to the org's provider account instead of Tollgate's
 * shared key.
 *
 * Two things this deliberately never does:
 *  - echo a saved key back (the api doesn't return one; only a "sk-…7mQ4" hint)
 *  - report success on a key the provider hasn't accepted — the api verifies
 *    against the real provider before storing, and a rejection surfaces here
 *    verbatim rather than as a generic error.
 */

type RowState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "error"; message: string }
  | { kind: "saved"; message: string };

function statusLabel(provider: UpstreamKeyStatus): {
  text: string;
  color: string;
} {
  if (provider.isSet) {
    return { text: `Set · ${provider.keyHint ?? ""}`, color: "var(--ok)" };
  }
  // Deliberately doesn't claim whether Tollgate's shared fallback key covers
  // this provider: only the proxy service holds those keys, so the api can't
  // know (see the GET route's doc comment). Better to say what IS true than to
  // assert a guess about another service's config.
  return { text: "Not set", color: "var(--muted-foreground)" };
}

function ProviderRow({
  provider,
  onChanged,
}: {
  provider: UpstreamKeyStatus;
  onChanged: () => Promise<void>;
}) {
  const [value, setValue] = useState("");
  const [state, setState] = useState<RowState>({ kind: "idle" });

  async function handleSave() {
    if (value.trim() === "") return;
    setState({ kind: "saving" });
    try {
      const result = await saveUpstreamKey(provider.slug, value.trim());
      // Clear immediately: the plaintext key should not linger in a form field
      // once it's stored, and it can never be shown again anyway.
      setValue("");
      setState({ kind: "saved", message: `Verified and saved (${result.keyHint}).` });
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

  async function handleRemove() {
    setState({ kind: "saving" });
    try {
      await deleteUpstreamKey(provider.slug);
      setState({ kind: "idle" });
      await onChanged();
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof ApiError ? err.message : "Couldn't remove that key.",
      });
    }
  }

  const status = statusLabel(provider);
  const saving = state.kind === "saving";

  return (
    <div className="flex flex-col gap-2 border-t py-4 first:border-t-0 first:pt-0">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={`upstream-key-${provider.slug}`}>{provider.label}</Label>
        <span className="font-mono text-xs" style={{ color: status.color }}>
          {status.text}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <Input
          id={`upstream-key-${provider.slug}`}
          // type=password so the key isn't shoulder-surfable while pasting, and
          // browsers don't offer to remember it as ordinary text.
          type="password"
          autoComplete="off"
          spellCheck={false}
          disabled={saving}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={
            provider.isSet
              ? "Paste a new key to replace the current one"
              : provider.slug === "claude"
                ? "sk-ant-…"
                : "sk-…"
          }
        />
        <Button type="button" onClick={handleSave} disabled={saving || value.trim() === ""}>
          {saving ? "Verifying…" : provider.isSet ? "Replace" : "Save"}
        </Button>
        {provider.isSet && (
          <Button type="button" variant="outline" onClick={handleRemove} disabled={saving}>
            Remove
          </Button>
        )}
      </div>

      {state.kind === "error" && (
        <p className="text-sm" style={{ color: "var(--err)" }}>
          {state.message}
        </p>
      )}
      {state.kind === "saved" && (
        <p className="text-sm" style={{ color: "var(--ok)" }}>
          {state.message}
        </p>
      )}
    </div>
  );
}

export function UpstreamKeysSettings() {
  const [data, setData] = useState<
    { vaultConfigured: boolean; providers: UpstreamKeyStatus[] } | null
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
        <ProviderRow key={provider.slug} provider={provider} onChanged={refresh} />
      ))}
    </div>
  );
}

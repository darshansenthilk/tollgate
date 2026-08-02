"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { ASSISTANT_ADAPTER_SLUGS } from "@tollgate/shared";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ApiError,
  type CreateAgentInput,
  type CreateAgentResponse,
  type UpstreamKeysResponse,
} from "@/lib/api";
import {
  MODELS_BY_PROVIDER,
  PROVIDERS,
  type ProviderSlug,
} from "@/lib/agent-options";
import { ConnectAgentSnippet } from "@/components/connect-agent-snippet";

/** Sentinel Select value for "don't pin a specific key" — Select's `value`
 *  being null shows the placeholder rather than a selectable "cleared" state,
 *  so an explicit option is simpler than fighting that. */
const DEPLOYMENT_DEFAULT_KEY = "__deployment_default__";

interface CreateAgentDialogProps {
  /** Injected so the exact same dialog works against the real api
   *  (lib/api.ts's createAgent) or the marketing page's demo simulator —
   *  neither is imported directly here. */
  createAgent: (input: CreateAgentInput) => Promise<CreateAgentResponse>;
  /** Optional: omitted on the marketing demo (no real org to fetch keys for)
   *  — see AgentDashboardActions's doc comment. When present, lets the org
   *  pin this agent to one of its stored BYOK keys instead of the deployment's
   *  shared one. */
  listUpstreamKeys?: () => Promise<UpstreamKeysResponse>;
  onCreated: (agent: CreateAgentResponse) => void;
  /**
   * Names of agents already fetched via GET /v1/agents. The backend also
   * rejects duplicates (409 agent_name_taken), but its check is case-sensitive
   * — this client-side check additionally catches "Foo" vs "foo" before a
   * round trip.
   */
  existingNames: string[];
}

export function CreateAgentDialog({
  createAgent,
  listUpstreamKeys,
  onCreated,
  existingNames,
}: CreateAgentDialogProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [providerSlug, setProviderSlug] = useState<ProviderSlug | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [maxBudgetCents, setMaxBudgetCents] = useState("");
  const [upstreamKeyId, setUpstreamKeyId] = useState<string | null>(null);
  const [upstreamKeys, setUpstreamKeys] = useState<UpstreamKeysResponse | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreateAgentResponse | null>(null);
  const [copied, setCopied] = useState(false);

  const modelOptions = providerSlug === null ? [] : MODELS_BY_PROVIDER[providerSlug];

  // Fetched once per open rather than on mount — a page that renders the
  // dialog behind a trigger shouldn't hit the api before the user asks for it.
  useEffect(() => {
    if (!open || listUpstreamKeys === undefined) return;
    let cancelled = false;
    void listUpstreamKeys().then((data) => {
      if (!cancelled) setUpstreamKeys(data);
    });
    return () => {
      cancelled = true;
    };
  }, [open, listUpstreamKeys]);

  // agent-options.ts's PROVIDERS values are the ASSISTANT label ("chatgpt");
  // org_upstream_keys is stored under the ADAPTER slug ("openai") — see
  // ASSISTANT_ADAPTER_SLUGS's doc comment for why the two differ.
  const keyOptions =
    providerSlug === null || upstreamKeys === null
      ? []
      : (upstreamKeys.providers.find((p) => p.slug === ASSISTANT_ADAPTER_SLUGS[providerSlug])
          ?.keys ?? []);

  function resetAndClose() {
    setOpen(false);
    // Reset after the close animation so the form doesn't visibly flash blank.
    setTimeout(() => {
      setName("");
      setProviderSlug(null);
      setModel(null);
      setMaxBudgetCents("");
      setUpstreamKeyId(null);
      setError(null);
      setCreated(null);
      setCopied(false);
    }, 150);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const trimmedName = name.trim();
      const isDuplicate = existingNames.some(
        (existing) => existing.toLowerCase() === trimmedName.toLowerCase(),
      );
      if (isDuplicate) {
        setError(`An agent named "${trimmedName}" already exists`);
        return;
      }
      if (providerSlug === null) {
        setError("Select an assistant");
        return;
      }
      if (model === null) {
        setError("Select a model");
        return;
      }
      const budget = maxBudgetCents.trim() === "" ? null : Number(maxBudgetCents);
      if (budget !== null && (!Number.isFinite(budget) || budget < 0)) {
        setError("Max budget must be a non-negative number of cents");
        return;
      }
      const agent = await createAgent({
        name: trimmedName,
        providerSlug,
        maxBudgetCents: budget,
        model,
        upstreamKeyId,
      });
      setCreated(agent);
      onCreated(agent);
    } catch (err) {
      // ApiError.message is already a clear, human-readable string here (e.g.
      // the backend's 409 agent_name_taken message), not a raw error code —
      // see lib/api.ts's request() for how that's resolved.
      setError(err instanceof ApiError ? err.message : "Request failed");
    } finally {
      setPending(false);
    }
  }

  async function handleCopy() {
    if (created === null) return;
    try {
      await navigator.clipboard.writeText(created.token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be denied (permissions, insecure context, iframe
      // embedding) — the token is still selectable/copyable by hand from the
      // <code> element, so this isn't fatal.
      setError("Couldn't copy automatically — select the token text and copy it manually.");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) resetAndClose();
        else setOpen(true);
      }}
    >
      {/* default, not brandOutline: coral is no longer the generic
          "emphasised action" outline — the dashboard's primary button is now
          the same white-on-near-black fill as the landing page's CTAs. */}
      <DialogTrigger render={<Button variant="default" />}>
        <Plus />
        Create agent
      </DialogTrigger>
      <DialogContent className={created !== null ? "sm:max-w-lg" : undefined}>
        {created === null ? (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>Create agent</DialogTitle>
              <DialogDescription>
                Issues a new Tollgate token scoped to this agent.
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="agent-name">Name</Label>
              <Input
                id="agent-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="checkout-bot"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="agent-provider">Assistant</Label>
                <Select
                  items={PROVIDERS}
                  value={providerSlug}
                  onValueChange={(value) => {
                    setProviderSlug(value);
                    setModel(null);
                    setUpstreamKeyId(null);
                  }}
                >
                  <SelectTrigger id="agent-provider">
                    <SelectValue placeholder="Select an assistant" />
                  </SelectTrigger>
                  <SelectContent>
                    {PROVIDERS.map((provider) => (
                      <SelectItem key={provider.value} value={provider.value}>
                        {provider.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="agent-model">Model</Label>
                {/* Free text with suggestions, not a fixed dropdown: the proxy
                    never validates the model (it just forwards whatever the
                    agent sends), and providers ship new ids constantly — so
                    limiting this list would block real models for no benefit.
                    The datalist keeps the common ones one keystroke away. */}
                <Input
                  id="agent-model"
                  list="agent-model-options"
                  autoComplete="off"
                  spellCheck={false}
                  disabled={providerSlug === null}
                  value={model ?? ""}
                  onChange={(e) => setModel(e.target.value.trim() === "" ? null : e.target.value)}
                  placeholder={providerSlug === null ? "Provider first" : "e.g. gpt-4o"}
                />
                <datalist id="agent-model-options">
                  {modelOptions.map((m) => (
                    <option key={m.value} value={m.value} />
                  ))}
                </datalist>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="agent-budget">Max budget (cents)</Label>
              <Input
                id="agent-budget"
                type="number"
                min={0}
                step={1}
                value={maxBudgetCents}
                onChange={(e) => setMaxBudgetCents(e.target.value)}
                placeholder="500 (= $5.00) — leave blank for unlimited"
              />
            </div>

            {keyOptions.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="agent-upstream-key">Upstream key</Label>
                <Select
                  items={[
                    { value: DEPLOYMENT_DEFAULT_KEY, label: "Deployment default" },
                    ...keyOptions.map((k) => ({ value: k.id, label: `${k.label} (${k.keyHint})` })),
                  ]}
                  value={upstreamKeyId ?? DEPLOYMENT_DEFAULT_KEY}
                  onValueChange={(value) =>
                    setUpstreamKeyId(value === DEPLOYMENT_DEFAULT_KEY ? null : value)
                  }
                >
                  <SelectTrigger id="agent-upstream-key">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={DEPLOYMENT_DEFAULT_KEY}>Deployment default</SelectItem>
                    {keyOptions.map((k) => (
                      <SelectItem key={k.id} value={k.id}>
                        {k.label} ({k.keyHint})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {error !== null && (
              <p className="text-sm" style={{ color: "var(--err)" }}>
                {error}
              </p>
            )}

            <DialogFooter>
              <Button type="submit" disabled={pending}>
                {pending ? "Creating…" : "Create agent"}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Agent created</DialogTitle>
              <DialogDescription>
                Copy this token now — the API never returns it again.
              </DialogDescription>
            </DialogHeader>

            <div
              className="rounded-lg border p-3"
              style={{ borderColor: "var(--err)", background: "color-mix(in oklch, var(--err) 10%, transparent)" }}
            >
              <p className="text-sm font-medium" style={{ color: "var(--err)" }}>
                You won&apos;t see this token again. Store it now.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <code className="flex-1 overflow-x-auto rounded-lg border bg-muted px-2.5 py-1.5 text-xs">
                {created.token}
              </code>
              <Button type="button" variant="outline" size="sm" onClick={handleCopy}>
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>

            {error !== null && (
              <p className="text-sm" style={{ color: "var(--err)" }}>
                {error}
              </p>
            )}

            <ConnectAgentSnippet
              providerSlug={created.providerSlug}
              model={created.model}
              token={created.token}
              allowTest
            />

            <DialogFooter>
              <Button type="button" onClick={resetAndClose}>
                Done
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

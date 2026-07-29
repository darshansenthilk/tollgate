"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
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
} from "@/lib/api";
import {
  MODELS_BY_PROVIDER,
  PROVIDERS,
  type ProviderSlug,
} from "@/lib/agent-options";
import { ConnectAgentSnippet } from "@/components/connect-agent-snippet";

interface CreateAgentDialogProps {
  /** Injected so the exact same dialog works against the real api
   *  (lib/api.ts's createAgent) or the marketing page's demo simulator —
   *  neither is imported directly here. */
  createAgent: (input: CreateAgentInput) => Promise<CreateAgentResponse>;
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
  onCreated,
  existingNames,
}: CreateAgentDialogProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [providerSlug, setProviderSlug] = useState<ProviderSlug | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [maxBudgetCents, setMaxBudgetCents] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreateAgentResponse | null>(null);
  const [copied, setCopied] = useState(false);

  const modelOptions = providerSlug === null ? [] : MODELS_BY_PROVIDER[providerSlug];

  function resetAndClose() {
    setOpen(false);
    // Reset after the close animation so the form doesn't visibly flash blank.
    setTimeout(() => {
      setName("");
      setProviderSlug(null);
      setModel(null);
      setMaxBudgetCents("");
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
                <Select
                  items={modelOptions}
                  value={model}
                  onValueChange={(value) => setModel(value)}
                  disabled={providerSlug === null}
                >
                  <SelectTrigger id="agent-model">
                    <SelectValue
                      placeholder={providerSlug === null ? "Provider first" : "Select model"}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {modelOptions.map((m) => (
                      <SelectItem key={m.value} value={m.value}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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

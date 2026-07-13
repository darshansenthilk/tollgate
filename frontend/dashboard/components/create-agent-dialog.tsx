"use client";

import { useState } from "react";
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
import { ApiError, createAgent, type CreateAgentResponse } from "@/lib/api";

/** The only providers selectable from the dashboard today. */
const PROVIDERS = [
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
] as const;

type ProviderSlug = (typeof PROVIDERS)[number]["value"];

interface CreateAgentDialogProps {
  onCreated: (agent: CreateAgentResponse) => void;
}

export function CreateAgentDialog({ onCreated }: CreateAgentDialogProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [providerSlug, setProviderSlug] = useState<ProviderSlug | null>(null);
  const [maxBudgetCents, setMaxBudgetCents] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreateAgentResponse | null>(null);
  const [copied, setCopied] = useState(false);

  function resetAndClose() {
    setOpen(false);
    // Reset after the close animation so the form doesn't visibly flash blank.
    setTimeout(() => {
      setName("");
      setProviderSlug(null);
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
      if (providerSlug === null) {
        setError("Select a provider");
        return;
      }
      const budget = maxBudgetCents.trim() === "" ? null : Number(maxBudgetCents);
      if (budget !== null && (!Number.isFinite(budget) || budget < 0)) {
        setError("Max budget must be a non-negative number of cents");
        return;
      }
      const agent = await createAgent({ name, providerSlug, maxBudgetCents: budget });
      setCreated(agent);
      onCreated(agent);
    } catch (err) {
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
      <DialogTrigger render={<Button />}>Create agent</DialogTrigger>
      <DialogContent>
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

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="agent-provider">Provider</Label>
              <Select
                items={PROVIDERS}
                value={providerSlug}
                onValueChange={(value) => setProviderSlug(value)}
              >
                <SelectTrigger id="agent-provider">
                  <SelectValue placeholder="Select provider" />
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

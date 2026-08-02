"use client";

import { useEffect, useMemo, useState } from "react";
import { ASSISTANT_ADAPTER_SLUGS } from "@tollgate/shared";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { modelsForProvider, providerLabel } from "@/lib/agent-options";
import {
  ApiError,
  type AgentListItem,
  type UpdateAgentInput,
  type UpdateAgentResponse,
  type UpstreamKeysResponse,
} from "@/lib/api";

/** Sentinel Select value for "don't pin a specific key" — see
 *  create-agent-dialog.tsx's identical constant for why. */
const DEPLOYMENT_DEFAULT_KEY = "__deployment_default__";

interface EditAgentDialogProps {
  /** null = closed. Like AgentPromptSidebar, this is looked up fresh from the
   *  live (polled) agents list each render — see the seeding note below for
   *  why that does NOT clobber in-progress edits. */
  agent: AgentListItem | null;
  /** Injected so the exact same dialog works against the real api
   *  (lib/api.ts's updateAgent) or the marketing page's demo simulator. */
  updateAgent: (id: string, input: UpdateAgentInput) => Promise<UpdateAgentResponse>;
  /** Optional: omitted on the marketing demo — see AgentDashboardActions's doc
   *  comment and create-agent-dialog.tsx's identical prop. */
  listUpstreamKeys?: () => Promise<UpstreamKeysResponse>;
  onOpenChange: (open: boolean) => void;
  onUpdated: (agent: UpdateAgentResponse) => void;
  /** Names of every agent currently listed, including this one's. */
  existingNames: string[];
}

export function EditAgentDialog({
  agent,
  updateAgent,
  listUpstreamKeys,
  onOpenChange,
  onUpdated,
  existingNames,
}: EditAgentDialogProps) {
  // Snapshot of the agent as it was when the dialog opened. It's both the
  // baseline for the dirty check and what the form renders from.
  const [editing, setEditing] = useState<AgentListItem | null>(null);
  const [name, setName] = useState("");
  const [model, setModel] = useState<string | null>(null);
  const [maxBudgetCents, setMaxBudgetCents] = useState("");
  const [upstreamKeyId, setUpstreamKeyId] = useState<string | null>(null);
  const [upstreamKeys, setUpstreamKeys] = useState<UpstreamKeysResponse | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (agent === null || listUpstreamKeys === undefined) return;
    let cancelled = false;
    void listUpstreamKeys().then((data) => {
      if (!cancelled) setUpstreamKeys(data);
    });
    return () => {
      cancelled = true;
    };
  }, [agent === null, listUpstreamKeys]);

  const keyOptions =
    editing === null || upstreamKeys === null
      ? []
      : (upstreamKeys.providers.find((p) => p.slug === ASSISTANT_ADAPTER_SLUGS[editing.providerSlug])
          ?.keys ?? []);

  // React's documented "adjusting state when a prop changes" pattern, keyed on
  // the agent's *id* rather than the object. `agent` is re-derived from the 3s
  // poll on every render, so reseeding on object identity would wipe whatever
  // the user was typing on every tick. The snapshot also deliberately survives
  // close (never reset to null) so the dialog doesn't blank out mid
  // close-animation — the same problem create-agent-dialog.tsx solves with a
  // 150ms delayed reset.
  if (agent !== null && agent.id !== editing?.id) {
    setEditing(agent);
    setName(agent.name);
    setModel(agent.model);
    setMaxBudgetCents(agent.maxBudgetCents === null ? "" : String(agent.maxBudgetCents));
    setUpstreamKeyId(agent.upstreamKeyId);
    setError(null);
  }

  // An agent created via the api (or before the current model list) can hold a
  // model that isn't in MODELS_BY_PROVIDER. The field itself is free text so it
  // always displays correctly either way; appending keeps the agent's own
  // current model in the suggestion list after the user starts editing.
  const modelOptions = useMemo(() => {
    const base = modelsForProvider(editing?.providerSlug ?? "");
    const current = editing?.model;
    if (current != null && current !== "" && !base.some((m) => m.value === current)) {
      return [...base, { value: current, label: current }];
    }
    return base;
  }, [editing]);

  const trimmedName = name.trim();
  const budgetValue = maxBudgetCents.trim() === "" ? null : Number(maxBudgetCents);

  const isDirty =
    editing !== null &&
    (trimmedName !== editing.name ||
      model !== editing.model ||
      budgetValue !== editing.maxBudgetCents ||
      upstreamKeyId !== editing.upstreamKeyId);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (editing === null) return;
    setPending(true);
    setError(null);
    try {
      if (trimmedName === "") {
        setError("Name can't be empty");
        return;
      }
      // The agent's own name is in existingNames — exclude it, or renaming
      // "Foo" to "foo" would falsely collide with itself.
      const isDuplicate = existingNames.some(
        (existing) =>
          existing.toLowerCase() === trimmedName.toLowerCase() &&
          existing.toLowerCase() !== editing.name.toLowerCase(),
      );
      if (isDuplicate) {
        setError(`An agent named "${trimmedName}" already exists`);
        return;
      }
      if (budgetValue !== null && (!Number.isFinite(budgetValue) || budgetValue < 0)) {
        setError("Max budget must be a non-negative number of cents");
        return;
      }

      // Send only what actually changed — an omitted key means "leave alone".
      const input: UpdateAgentInput = {};
      if (trimmedName !== editing.name) input.name = trimmedName;
      if (model !== editing.model) input.model = model;
      if (budgetValue !== editing.maxBudgetCents) input.maxBudgetCents = budgetValue;
      if (upstreamKeyId !== editing.upstreamKeyId) input.upstreamKeyId = upstreamKeyId;

      const updated = await updateAgent(editing.id, input);
      onUpdated(updated);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Request failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={agent !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Edit agent</DialogTitle>
            <DialogDescription>
              The agent keeps its token and this month&apos;s spend. Its assistant is
              fixed once created.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-agent-name">Name</Label>
            <Input
              id="edit-agent-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="checkout-bot"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-agent-assistant">Assistant</Label>
              {/* Read-only: providerSlug is the proxy's authorization boundary
                  for which upstream this agent's token may reach, so it can't
                  be edited. The api rejects it too (provider_slug_immutable). */}
              <Input
                id="edit-agent-assistant"
                value={providerLabel(editing?.providerSlug ?? "")}
                disabled
                readOnly
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-agent-model">Model</Label>
              {/* Free text with suggestions — see create-agent-dialog.tsx. */}
              <Input
                id="edit-agent-model"
                list="edit-agent-model-options"
                autoComplete="off"
                spellCheck={false}
                value={model ?? ""}
                onChange={(e) => setModel(e.target.value.trim() === "" ? null : e.target.value)}
                placeholder="e.g. gpt-4o"
              />
              <datalist id="edit-agent-model-options">
                {modelOptions.map((m) => (
                  <option key={m.value} value={m.value} />
                ))}
              </datalist>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-agent-budget">Max budget (cents)</Label>
            <Input
              id="edit-agent-budget"
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
              <Label htmlFor="edit-agent-upstream-key">Upstream key</Label>
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
                <SelectTrigger id="edit-agent-upstream-key">
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
            <Button type="submit" disabled={pending || !isDirty}>
              {pending ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

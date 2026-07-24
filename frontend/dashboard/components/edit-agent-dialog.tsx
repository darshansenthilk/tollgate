"use client";

import { useMemo, useState } from "react";
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
  updateAgent,
  type AgentListItem,
  type UpdateAgentInput,
  type UpdateAgentResponse,
} from "@/lib/api";

interface EditAgentDialogProps {
  /** null = closed. Like AgentPromptSidebar, this is looked up fresh from the
   *  live (polled) agents list each render — see the seeding note below for
   *  why that does NOT clobber in-progress edits. */
  agent: AgentListItem | null;
  onOpenChange: (open: boolean) => void;
  onUpdated: (agent: UpdateAgentResponse) => void;
  /** Names of every agent currently listed, including this one's. */
  existingNames: string[];
}

export function EditAgentDialog({
  agent,
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
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    setError(null);
  }

  // An agent created via the api (or before the current model list) can hold a
  // model that isn't in MODELS_BY_PROVIDER. Append it so the Select still shows
  // the real current value instead of rendering blank.
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
      budgetValue !== editing.maxBudgetCents);

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
              <Select
                items={modelOptions}
                value={model}
                onValueChange={(value) => setModel(value)}
              >
                <SelectTrigger id="edit-agent-model">
                  <SelectValue placeholder="Select model" />
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

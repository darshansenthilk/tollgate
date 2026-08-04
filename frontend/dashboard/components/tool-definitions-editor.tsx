"use client";

import { Plus, X } from "lucide-react";
import type { ToolDefinition } from "@tollgate/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

/**
 * One row of the tools editor before it's been validated into a
 * ToolDefinition. `parametersJson` stays free text (not parsed on every
 * keystroke) so a mid-edit invalid JSON document doesn't get silently
 * discarded or block typing — it's only parsed at submit time, via
 * parseToolDrafts.
 */
export interface ToolDefinitionDraft {
  name: string;
  description: string;
  parametersJson: string;
}

const EMPTY_PARAMETERS = '{\n  "type": "object",\n  "properties": {}\n}';

export function emptyToolDraft(): ToolDefinitionDraft {
  return { name: "", description: "", parametersJson: EMPTY_PARAMETERS };
}

export function toolDefinitionsToDrafts(tools: ToolDefinition[] | null): ToolDefinitionDraft[] {
  if (tools === null) return [];
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    parametersJson: JSON.stringify(t.parameters, null, 2),
  }));
}

/**
 * Validates and serializes drafts into what the api accepts — see
 * backend/api/src/routes/agents.ts's parseToolDefinitions for the mirrored
 * server-side rules (name pattern/length, description length, parameters
 * must be a plain object). Errors name which row failed, since a raw
 * JSON.parse error ("Unexpected token") wouldn't tell the operator WHICH
 * tool broke it.
 */
export function parseToolDrafts(
  drafts: ToolDefinitionDraft[],
): { ok: true; value: ToolDefinition[] | null } | { ok: false; error: string } {
  const seen = new Set<string>();
  const out: ToolDefinition[] = [];
  for (const [i, d] of drafts.entries()) {
    const name = d.name.trim();
    const description = d.description.trim();
    // A row added via "Add tool" but never filled in is a blank scratch
    // entry, not a tool to submit — drop it rather than erroring.
    if (name === "" && description === "") continue;

    const label = name === "" ? `#${i + 1}` : `"${name}"`;
    if (name === "") return { ok: false, error: `Tool ${label} needs a name.` };
    if (description === "") return { ok: false, error: `Tool ${label} needs a description.` };
    if (seen.has(name)) return { ok: false, error: `Tool "${name}" is defined more than once.` };
    seen.add(name);

    const paramsText = d.parametersJson.trim();
    let parameters: unknown;
    try {
      parameters = paramsText === "" ? {} : JSON.parse(paramsText);
    } catch {
      return { ok: false, error: `Tool "${name}"'s parameters aren't valid JSON.` };
    }
    if (typeof parameters !== "object" || parameters === null || Array.isArray(parameters)) {
      return { ok: false, error: `Tool "${name}"'s parameters must be a JSON object.` };
    }

    out.push({ name, description, parameters: parameters as Record<string, unknown> });
  }
  return { ok: true, value: out.length === 0 ? null : out };
}

interface ToolDefinitionsEditorProps {
  /** Disambiguates element ids between the create and edit dialogs, which can
   *  both be mounted at once. */
  idPrefix: string;
  drafts: ToolDefinitionDraft[];
  onChange: (drafts: ToolDefinitionDraft[]) => void;
}

/**
 * Repeatable name/description/parameters-JSON rows for defining the tools
 * injected into this agent's outgoing requests — see @tollgate/shared's
 * ToolDefinition doc comment. Tollgate advertises these to the model; it
 * doesn't execute them (tool execution is a separate, not-yet-built piece).
 * Shared by create-agent-dialog.tsx and edit-agent-dialog.tsx.
 */
export function ToolDefinitionsEditor({ idPrefix, drafts, onChange }: ToolDefinitionsEditorProps) {
  function updateRow(index: number, patch: Partial<ToolDefinitionDraft>) {
    onChange(drafts.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  }
  function removeRow(index: number) {
    onChange(drafts.filter((_, i) => i !== index));
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <Label>Tools (optional)</Label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange([...drafts, emptyToolDraft()])}
        >
          <Plus className="size-3.5" />
          Add tool
        </Button>
      </div>

      {drafts.length === 0 && (
        <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
          No tools defined — the agent&apos;s calling app supplies its own tool list, or none.
        </p>
      )}

      {drafts.map((draft, i) => (
        <div
          key={i}
          className="flex flex-col gap-2 rounded-lg border p-3"
          style={{ borderColor: "var(--line)", background: "var(--panel)" }}
        >
          <div className="flex items-start gap-2">
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor={`${idPrefix}-tool-${i}-name`}>Name</Label>
              <Input
                id={`${idPrefix}-tool-${i}-name`}
                value={draft.name}
                onChange={(e) => updateRow(i, { name: e.target.value })}
                placeholder="lookup_order"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="mt-6"
              onClick={() => removeRow(i)}
              aria-label={`Remove tool ${i + 1}`}
            >
              <X className="size-4" />
            </Button>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${idPrefix}-tool-${i}-description`}>Description</Label>
            <Input
              id={`${idPrefix}-tool-${i}-description`}
              value={draft.description}
              onChange={(e) => updateRow(i, { description: e.target.value })}
              placeholder="Look up an order by id."
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${idPrefix}-tool-${i}-parameters`}>Parameters (JSON Schema)</Label>
            <Textarea
              id={`${idPrefix}-tool-${i}-parameters`}
              value={draft.parametersJson}
              onChange={(e) => updateRow(i, { parametersJson: e.target.value })}
              className="font-mono text-xs"
              rows={4}
              spellCheck={false}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

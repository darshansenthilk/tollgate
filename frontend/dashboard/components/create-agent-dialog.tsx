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
import { Textarea } from "@/components/ui/textarea";
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
  draftAgent,
  isDraftAvailable,
  saveAnthropicLink,
  type CreateAgentInput,
  type CreateAgentResponse,
  type UpstreamKeysResponse,
} from "@/lib/api";
import {
  MODELS_BY_PROVIDER,
  PROVIDERS,
  parseBlockedTools,
  type ProviderSlug,
} from "@/lib/agent-options";
import { ConnectAgentSnippet } from "@/components/connect-agent-snippet";
import { ConnectMcpSnippet } from "@/components/connect-mcp-snippet";
import { AnthropicLinkFields } from "@/components/anthropic-link-fields";
import {
  ToolDefinitionsEditor,
  parseToolDrafts,
  type ToolDefinitionDraft,
} from "@/components/tool-definitions-editor";

/** Sentinel Select value for "don't pin a specific key" — Select's `value`
 *  being null shows the placeholder rather than a selectable "cleared" state,
 *  so an explicit option is simpler than fighting that. */
const DEPLOYMENT_DEFAULT_KEY = "__deployment_default__";

/** Sentinel for "a normal, Tollgate-proxied agent" (hostPlatform: null) — same
 *  reasoning as DEPLOYMENT_DEFAULT_KEY above. Values match the backend's
 *  ALLOWED_HOST_PLATFORMS (backend/api/src/routes/agents.ts) exactly.
 *
 *  Salesforce Agentforce is deliberately not offered here yet — its usage/
 *  cost connector isn't built (Phase 3 of the approved plan), so there's
 *  nothing behind the option if an agent were created with it. Add it back
 *  alongside that connector, once ALLOWED_HOST_PLATFORMS accepts it again. */
const TOLLGATE_PROXIED = "__tollgate_proxied__";
const HOST_PLATFORMS = [{ value: "anthropic_managed_agents", label: "Anthropic Managed Agents" }];

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
  const [hostPlatform, setHostPlatform] = useState<string | null>(null);
  const [mcpTargetKeyId, setMcpTargetKeyId] = useState<string | null>(null);
  // Anthropic Managed Agents link — folded straight into creation so linking
  // is one step instead of "create, then edit to configure the link". Only
  // anthropicApiKeyId is meaningful without the others; all optional here
  // (an operator can always finish this later via Edit agent).
  const [anthropicApiKeyId, setAnthropicApiKeyId] = useState("");
  const [anthropicWorkspaceId, setAnthropicWorkspaceId] = useState("");
  const [anthropicSessionId, setAnthropicSessionId] = useState("");
  const [anthropicUpstreamKeyId, setAnthropicUpstreamKeyId] = useState<string | null>(null);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [blockedTools, setBlockedTools] = useState("");
  const [toolDrafts, setToolDrafts] = useState<ToolDefinitionDraft[]>([]);
  const [description, setDescription] = useState("");
  const [drafting, setDrafting] = useState(false);
  /** Whether the blocked-tools field was filled by the model rather than
   *  typed. Drives the caution note below — see where it's rendered. */
  const [draftedTools, setDraftedTools] = useState(false);
  /** undefined until the probe lands, so the wizard doesn't flash in and then
   *  disappear on a deployment that has no local model. */
  const [draftAvailable, setDraftAvailable] = useState<boolean | undefined>(undefined);
  const [upstreamKeys, setUpstreamKeys] = useState<UpstreamKeysResponse | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreateAgentResponse | null>(null);
  const [copied, setCopied] = useState(false);

  const modelOptions = providerSlug === null ? [] : MODELS_BY_PROVIDER[providerSlug];

  // Probed once per open, alongside the keys fetch below and for the same
  // reason. Skipped on the marketing demo (no listUpstreamKeys => no real api
  // to ask), which also keeps the wizard out of the demo simulator.
  useEffect(() => {
    if (!open || listUpstreamKeys === undefined) return;
    let cancelled = false;
    void isDraftAvailable()
      .then((res) => {
        if (!cancelled) setDraftAvailable(res.available);
      })
      .catch(() => {
        // An unreachable probe is indistinguishable from "no model" as far as
        // the operator is concerned — hide the wizard either way.
        if (!cancelled) setDraftAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, listUpstreamKeys]);

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

  // "mcp-downstream" keys aren't tied to providerSlug — they're the real
  // downstream tool server this agent's MCP-gated calls forward to,
  // independent of which assistant it's nominally provisioned for.
  const mcpKeyOptions =
    upstreamKeys === null
      ? []
      : (upstreamKeys.providers.find((p) => p.slug === "mcp-downstream")?.keys ?? []);

  const anthropicAdminKeyOptions =
    upstreamKeys === null
      ? []
      : (upstreamKeys.providers.find((p) => p.slug === "anthropic-admin")?.keys ?? []);

  function resetAndClose() {
    setOpen(false);
    // Reset after the close animation so the form doesn't visibly flash blank.
    setTimeout(() => {
      setName("");
      setProviderSlug(null);
      setModel(null);
      setMaxBudgetCents("");
      setUpstreamKeyId(null);
      setHostPlatform(null);
      setMcpTargetKeyId(null);
      setAnthropicApiKeyId("");
      setAnthropicWorkspaceId("");
      setAnthropicSessionId("");
      setAnthropicUpstreamKeyId(null);
      setSystemPrompt("");
      setBlockedTools("");
      setToolDrafts([]);
      setDescription("");
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
      const toolsResult = parseToolDrafts(toolDrafts);
      if (!toolsResult.ok) {
        setError(toolsResult.error);
        return;
      }
      const agent = await createAgent({
        name: trimmedName,
        providerSlug,
        maxBudgetCents: budget,
        model,
        upstreamKeyId,
        systemPrompt: systemPrompt.trim() === "" ? null : systemPrompt.trim(),
        blockedTools: parseBlockedTools(blockedTools),
        toolDefinitions: toolsResult.value,
        hostPlatform,
        mcpTargetKeyId,
      });
      setCreated(agent);
      onCreated(agent);

      // Folds "link this agent to Anthropic Managed Agents" into creation
      // itself — one step instead of "create, then edit to configure the
      // link". listUpstreamKeys undefined means the marketing demo (no real
      // api, no real agent id to attach a link to) — skip entirely there.
      if (
        hostPlatform === "anthropic_managed_agents" &&
        anthropicApiKeyId.trim() !== "" &&
        listUpstreamKeys !== undefined
      ) {
        try {
          await saveAnthropicLink(agent.id, {
            anthropicApiKeyId: anthropicApiKeyId.trim(),
            anthropicWorkspaceId: anthropicWorkspaceId.trim() === "" ? null : anthropicWorkspaceId.trim(),
            currentSessionId: anthropicSessionId.trim() === "" ? null : anthropicSessionId.trim(),
            upstreamKeyId: anthropicUpstreamKeyId,
          });
        } catch (linkErr) {
          // The agent itself was created successfully — don't fail the whole
          // flow over the link, just say so; it's editable later either way.
          setError(
            `Agent created, but the Anthropic link couldn't be saved: ${
              linkErr instanceof ApiError ? linkErr.message : "request failed"
            }. Configure it from Edit agent instead.`,
          );
        }
      }
    } catch (err) {
      // ApiError.message is already a clear, human-readable string here (e.g.
      // the backend's 409 agent_name_taken message), not a raw error code —
      // see lib/api.ts's request() for how that's resolved.
      setError(err instanceof ApiError ? err.message : "Request failed");
    } finally {
      setPending(false);
    }
  }

  /**
   * Fills the form from the local model's draft. Deliberately only fills
   * fields the operator hasn't already typed into — a draft is a starting
   * point, and silently overwriting something they wrote would be the one
   * behaviour that makes the button untrustworthy. Nothing is created here;
   * they still review and submit.
   */
  async function handleDraft() {
    if (description.trim() === "") {
      setError("Describe what the agent should do first");
      return;
    }
    setDrafting(true);
    setError(null);
    setDraftedTools(false);
    try {
      const draft = await draftAgent(description.trim());

      // A small model that returns unparseable JSON yields an all-empty draft
      // (see parseDraft — it degrades rather than throwing). Observed in
      // testing when the model was still loading. Without this the button
      // just appears to do nothing, which reads as a broken feature rather
      // than a retryable one.
      const empty =
        draft.name === null &&
        draft.systemPrompt === null &&
        draft.blockedTools.length === 0 &&
        draft.maxBudgetCents === null;
      if (empty) {
        setError("The local model didn't return a usable draft — try again, or rephrase.");
        return;
      }

      if (draft.name !== null && name.trim() === "") setName(draft.name);
      if (draft.systemPrompt !== null && systemPrompt.trim() === "") {
        setSystemPrompt(draft.systemPrompt);
      }
      if (draft.blockedTools.length > 0 && blockedTools.trim() === "") {
        setBlockedTools(draft.blockedTools.join(", "));
        setDraftedTools(true);
      }
      if (draft.maxBudgetCents !== null && maxBudgetCents.trim() === "") {
        setMaxBudgetCents(String(draft.maxBudgetCents));
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't reach the local model");
    } finally {
      setDrafting(false);
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

            {draftAvailable === true && (
              <div
                className="flex flex-col gap-1.5 rounded-lg border p-3"
                style={{ borderColor: "var(--line)", background: "var(--panel)" }}
              >
                <Label htmlFor="agent-description">Describe it, and we&apos;ll draft it</Label>
                <Textarea
                  id="agent-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="A support bot that handles refunds under $100 but must never delete customer records or send payments."
                />
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={drafting}
                    onClick={() => void handleDraft()}
                  >
                    {drafting ? "Drafting…" : "Draft with local AI"}
                  </Button>
                  {/* Says where the model runs, because "AI will read this" is
                      exactly the moment an operator wants to know whether
                      their description just left the building. It didn't. */}
                  <span className="text-xs" style={{ color: "var(--muted-foreground)" }}>
                    Runs on your own deployment — nothing is sent to a provider.
                  </span>
                </div>
              </div>
            )}

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
              <Label htmlFor="agent-host-platform">Hosting</Label>
              <Select
                items={[
                  { value: TOLLGATE_PROXIED, label: "Tollgate-proxied (default)" },
                  ...HOST_PLATFORMS,
                ]}
                value={hostPlatform ?? TOLLGATE_PROXIED}
                onValueChange={(value) => {
                  setHostPlatform(value === TOLLGATE_PROXIED ? null : value);
                  setMcpTargetKeyId(null);
                }}
              >
                <SelectTrigger id="agent-host-platform">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={TOLLGATE_PROXIED}>Tollgate-proxied (default)</SelectItem>
                  {HOST_PLATFORMS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {hostPlatform !== null && (
                // The single most important thing to say here: this agent's
                // own LLM traffic never touches Tollgate — only its tool
                // calls do, via the MCP gateway. Assistant/model below stay
                // required (descriptive, for the dashboard's own display),
                // not because Tollgate proxies them.
                <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
                  This agent&apos;s LLM traffic runs on {HOST_PLATFORMS.find((p) => p.value === hostPlatform)?.label} directly — Tollgate only governs its tool calls, via the MCP server URL shown after creation.
                </p>
              )}
            </div>

            {hostPlatform === "anthropic_managed_agents" && listUpstreamKeys !== undefined && (
              <div
                className="flex flex-col gap-3 rounded-lg border p-3"
                style={{ borderColor: "var(--line)", background: "var(--panel)" }}
              >
                <p className="text-sm font-medium">Anthropic Managed Agents link (optional)</p>
                <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
                  Fill this in now to start tracking real spend right away, or
                  skip it and add it later from Edit agent. Real usage syncs
                  automatically every few minutes once it&apos;s set — no
                  separate cron or setup step needed.
                </p>
                <AnthropicLinkFields
                  idPrefix="create-anthropic-link"
                  apiKeyId={anthropicApiKeyId}
                  onApiKeyIdChange={setAnthropicApiKeyId}
                  workspaceId={anthropicWorkspaceId}
                  onWorkspaceIdChange={setAnthropicWorkspaceId}
                  sessionId={anthropicSessionId}
                  onSessionIdChange={setAnthropicSessionId}
                  upstreamKeyId={anthropicUpstreamKeyId}
                  onUpstreamKeyIdChange={setAnthropicUpstreamKeyId}
                  adminKeyOptions={anthropicAdminKeyOptions}
                />
              </div>
            )}

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

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="agent-system-prompt">System prompt (optional)</Label>
              {/* Prepended to every request this agent sends — see
                  backend/proxy/src/adapters/openai-usage.ts's
                  injectOpenAiSystemPrompt. Defines the agent's behavior once,
                  centrally, instead of every calling app repeating it. */}
              <Textarea
                id="agent-system-prompt"
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder="You are a support agent for Acme Corp. Be concise and never discuss pricing."
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="agent-blocked-tools">Blocked tools (optional)</Label>
              {/* Comma-separated tool/function names — see
                  backend/proxy/src/routes/proxy.ts's tool gate (step 8). */}
              <Input
                id="agent-blocked-tools"
                value={blockedTools}
                onChange={(e) => {
                  setBlockedTools(e.target.value);
                  setDraftedTools(false);
                }}
                placeholder="delete_customer, send_payment"
              />
              {draftedTools && (
                // The single most important caveat in this whole wizard. A
                // model reading "must never delete customer records" invents a
                // plausible NAME for that tool — in testing, "deleteCustomerRecord".
                // The gate matches on exact names, so if the agent's real tool
                // is "delete_customer" this blocklist blocks nothing while
                // looking like it does. Silence here would be the dangerous
                // kind of convenience.
                <p className="text-xs" style={{ color: "var(--amber)" }}>
                  Guessed from your description — check these against the tool
                  names your agent actually calls. Blocking only works on an
                  exact match.
                </p>
              )}
            </div>

            <ToolDefinitionsEditor
              idPrefix="create"
              drafts={toolDrafts}
              onChange={setToolDrafts}
            />

            {/* Meaningless for an externally-hosted agent — its LLM traffic
                never reaches Tollgate's proxy, so there's no upstream call to
                pick a key for. */}
            {hostPlatform === null && keyOptions.length > 0 && (
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

            {hostPlatform !== null && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="agent-mcp-target-key">MCP downstream server</Label>
                {mcpKeyOptions.length > 0 ? (
                  <Select
                    items={[
                      { value: DEPLOYMENT_DEFAULT_KEY, label: "None configured yet" },
                      ...mcpKeyOptions.map((k) => ({
                        value: k.id,
                        label: `${k.label} (${k.keyHint})`,
                      })),
                    ]}
                    value={mcpTargetKeyId ?? DEPLOYMENT_DEFAULT_KEY}
                    onValueChange={(value) =>
                      setMcpTargetKeyId(value === DEPLOYMENT_DEFAULT_KEY ? null : value)
                    }
                  >
                    <SelectTrigger id="agent-mcp-target-key">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={DEPLOYMENT_DEFAULT_KEY}>None configured yet</SelectItem>
                      {mcpKeyOptions.map((k) => (
                        <SelectItem key={k.id} value={k.id}>
                          {k.label} ({k.keyHint})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
                    No MCP downstream server saved yet — add one under Settings
                    → Upstream keys, then pick it here (or edit this agent
                    afterward).
                  </p>
                )}
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

            {created.hostPlatform !== null ? (
              <ConnectMcpSnippet hostPlatform={created.hostPlatform} token={created.token} />
            ) : (
              <ConnectAgentSnippet
                providerSlug={created.providerSlug}
                model={created.model}
                token={created.token}
                allowTest
              />
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

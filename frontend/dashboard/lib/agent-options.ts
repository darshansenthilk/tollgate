/**
 * Assistant + model choices offered by the dashboard, shared by the create and
 * edit dialogs. Extracted from create-agent-dialog.tsx once a second dialog
 * needed them — same reason lib/agent-status.ts exists.
 */

/** The assistants selectable from the dashboard today. */
export const PROVIDERS = [
  { value: "chatgpt", label: "ChatGPT" },
  { value: "claude", label: "Claude" },
  { value: "gemini", label: "Gemini" },
  { value: "azure", label: "Azure OpenAI" },
  { value: "bedrock", label: "AWS Bedrock" },
] as const;

export type ProviderSlug = (typeof PROVIDERS)[number]["value"];

/** Model choices per assistant. Keyed by the assistant slug above, not by the
 *  adapter slug the proxy routes on ("chatgpt" the label vs. "openai" the
 *  adapter) — backend/proxy/src/adapters/registry.ts's assistantAdapterSlugs is
 *  the one place that bridges the two. Persisted server-side via the `model`
 *  column on the agents table (backend/api/src/db/schema.ts). */
export const MODELS_BY_PROVIDER: Record<ProviderSlug, { value: string; label: string }[]> = {
  chatgpt: [
    { value: "gpt-4o", label: "gpt-4o" },
    { value: "gpt-4o-mini", label: "gpt-4o-mini" },
  ],
  claude: [
    { value: "opus", label: "Opus" },
    { value: "sonnet", label: "Sonnet" },
    { value: "haiku", label: "Haiku" },
  ],
  gemini: [
    { value: "gemini-1.5-pro", label: "Gemini 1.5 Pro" },
    { value: "gemini-1.5-flash", label: "Gemini 1.5 Flash" },
  ],
  // Azure addresses a DEPLOYMENT — the customer's own name for a model they
  // provisioned — not a model id, and those names are chosen per Azure
  // resource. There's no fixed list to offer, so these are the common
  // convention (deployment named after the model) and the field stays free
  // text: edit-agent-dialog appends whatever value an agent actually holds.
  azure: [
    { value: "gpt-4o", label: "gpt-4o (deployment name)" },
    { value: "gpt-4o-mini", label: "gpt-4o-mini (deployment name)" },
  ],
  // Bedrock model ids as AWS itself spells them — these are what the field
  // sends verbatim to the proxy path (see agent-connect.ts) and what a
  // response's own "model" comes back as, so free-typing any other Bedrock
  // id (a different provider's model, a new dated release) works exactly the
  // same as these suggestions do.
  bedrock: [
    {
      value: "anthropic.claude-3-5-sonnet-20241022-v2:0",
      label: "Claude 3.5 Sonnet",
    },
    {
      value: "anthropic.claude-3-5-haiku-20241022-v1:0",
      label: "Claude 3.5 Haiku",
    },
  ],
};

/**
 * Safe lookups for a slug that arrives from the api as a plain `string`
 * (AgentListItem.providerSlug), which may predate the current PROVIDERS list
 * or have been created via the api directly. Both degrade gracefully rather
 * than indexing undefined.
 */
export function providerLabel(slug: string): string {
  return PROVIDERS.find((p) => p.value === slug)?.label ?? slug;
}

export function modelsForProvider(slug: string): { value: string; label: string }[] {
  return MODELS_BY_PROVIDER[slug as ProviderSlug] ?? [];
}

/**
 * Local-LLM client, used to draft an agent's configuration from a plain-English
 * description (see routes/agent-draft.ts).
 *
 * LOCAL ON PURPOSE, not a provider adapter. The description a user types — and,
 * later, the prompts this will analyse for token waste — are the customer's own
 * data. Sending that to OpenAI to help them configure a tool whose whole job is
 * governing OpenAI spend would be self-defeating, and for a self-hosted
 * deployment (SELF_HOSTING.md) it's a non-starter: the point is that nothing
 * leaves the customer's infrastructure. Ollama runs beside the other compose
 * services and needs no API key.
 *
 * Deliberately NOT reusing backend/proxy's adapter registry. Those adapters
 * exist to forward a CUSTOMER's traffic through the metered hot path with their
 * vaulted credentials; this is the api calling its own sidecar for an internal
 * suggestion, off the hot path, with no spend to meter and no credential to
 * vault. Sharing the seam would drag budget/freeze semantics into a code path
 * that has no agent to charge.
 */

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
/** Small instruct model by default — this runs on whatever hardware the
 *  customer already has, so the default has to be something a laptop can hold.
 *  Override for a bigger one when the box can take it. */
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "llama3.2";

/**
 * A local model on CPU is genuinely slow: llama3.2 on a laptop-class box
 * overran 60s on this exact prompt during testing, twice, before NUM_PREDICT
 * below was added to bound the generation. Kept generous because the failure
 * this guards against is a wedged sidecar, not a slow one — and a draft that
 * arrives late is still useful, whereas a spurious timeout trains the operator
 * to distrust the button.
 */
const REQUEST_TIMEOUT_MS = 120_000;

/**
 * Hard cap on generated tokens. This is the single biggest lever on how long
 * the operator waits: a draft is four short fields, so anything beyond this is
 * the model padding — and on CPU every extra token is real wall-clock time.
 */
const NUM_PREDICT = 400;

/**
 * Keeps the model resident between drafts. Without it Ollama evicts after ~5
 * minutes and the next draft pays the multi-second load again, which is most
 * of the perceived latency for someone creating two agents in a row.
 */
const KEEP_ALIVE = "10m";
/** The availability probe is a UI affordance, not the feature — fail it fast so
 *  a dashboard load never blocks on an absent sidecar. */
const PROBE_TIMEOUT_MS = 2_000;

/**
 * A drafted agent configuration. Every field is optional from the model's
 * perspective and validated here before it leaves this module — see
 * parseDraft's doc comment for why none of it is trusted.
 */
export interface AgentDraft {
  name: string | null;
  systemPrompt: string | null;
  blockedTools: string[];
  maxBudgetCents: number | null;
}

export interface LocalLlm {
  /** Whether the configured model is actually usable, so the dashboard can
   *  hide the feature rather than offering a button that always errors. */
  isAvailable(): Promise<boolean>;
  draftAgent(description: string): Promise<AgentDraft>;
}

export class LocalLlmUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocalLlmUnavailableError";
  }
}

// ---------------------------------------------------------------------------
// Validation
//
// Everything below treats the model's output as UNTRUSTED DATA. Two reasons,
// and the first is the boring one that actually bites: small local models
// return malformed or half-hallucinated JSON regularly, so this has to degrade
// to "no suggestion" rather than throw. The second: the description is
// user-supplied text fed into a prompt, so a caller can influence what comes
// back. That influence is bounded here — a draft only ever pre-fills a form
// the operator reviews and submits themselves (routes/agent-draft.ts never
// writes an agent), and the values are clamped to ranges the api would accept
// from a hand-typed request anyway.
// ---------------------------------------------------------------------------

const NAME_MAX = 60;
const SYSTEM_PROMPT_MAX = 2_000;
const TOOL_NAME_PATTERN = /^[a-zA-Z0-9_.-]+$/;
const TOOL_NAME_MAX = 64;
const MAX_BLOCKED_TOOLS = 20;
/** $100,000/mo. Not a policy ceiling — just a bound that stops a hallucinated
 *  budget from pre-filling something absurd for a user who clicks straight
 *  through. The real ceiling is whatever the operator types. */
const MAX_BUDGET_CENTS = 10_000_000;

function readString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  return trimmed.length <= maxLength ? trimmed : trimmed.slice(0, maxLength);
}

function readBlockedTools(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const names: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    // Reject rather than sanitize: a "tool name" with spaces or punctuation is
    // a model describing a tool in prose, not naming one, and blocking a name
    // no provider will ever emit is worse than blocking nothing — it reads as
    // protection that isn't there.
    if (trimmed === "" || trimmed.length > TOOL_NAME_MAX) continue;
    if (!TOOL_NAME_PATTERN.test(trimmed)) continue;
    if (!names.includes(trimmed)) names.push(trimmed);
    if (names.length >= MAX_BLOCKED_TOOLS) break;
  }
  return names;
}

function readBudgetCents(value: unknown): number | null {
  const raw = typeof value === "string" ? Number(value) : value;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) return null;
  return Math.min(Math.round(raw), MAX_BUDGET_CENTS);
}

/** Narrow a model's JSON blob into an AgentDraft, dropping anything that
 *  doesn't survive validation. Never throws: a bad draft is an empty draft. */
export function parseDraft(raw: unknown): AgentDraft {
  if (typeof raw !== "object" || raw === null) {
    return { name: null, systemPrompt: null, blockedTools: [], maxBudgetCents: null };
  }
  const rec = raw as Record<string, unknown>;
  return {
    name: readString(rec["name"], NAME_MAX),
    systemPrompt: readString(rec["systemPrompt"], SYSTEM_PROMPT_MAX),
    blockedTools: readBlockedTools(rec["blockedTools"]),
    maxBudgetCents: readBudgetCents(rec["maxBudgetCents"]),
  };
}

/**
 * What the local model is asked to produce. Kept explicit about the shape
 * because small models drift without it, and explicit about the CONSERVATIVE
 * bias on blockedTools: this list is a safety control, and a model inventing
 * plausible-sounding tool names that no provider emits would produce a
 * blocklist that looks protective and blocks nothing.
 */
function buildPrompt(description: string): string {
  return [
    "You configure an AI agent for a spend-control gateway. Reply with JSON only.",
    "",
    "Fields:",
    '  "name": short kebab-case identifier, e.g. "refund-bot".',
    '  "systemPrompt": the agent\'s standing instructions, written in the second person.',
    '  "blockedTools": array of tool/function names the agent must never be allowed to call.',
    "      Use ONLY names the user described as forbidden, in snake_case.",
    "      Return an empty array if they described none. Do not invent names.",
    '  "maxBudgetCents": integer monthly ceiling in US cents, or null if unstated.',
    "",
    "Description:",
    description,
  ].join("\n");
}

interface OllamaGenerateResponse {
  response?: unknown;
}

async function postJson(url: string, body: unknown, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

interface GenerateOptions {
  prompt: string;
  numPredict: number;
  temperature: number;
  /** Ollama's constrained-decoding mode, which draftAgent wants (its output
   *  is JSON) — kept as its own field rather than always-on so a future
   *  free-text caller isn't forced to fight the format to get prose. */
  format?: "json";
}

/**
 * Call-and-error-mapping for hitting Ollama's /api/generate: translates its
 * failure modes into one LocalLlmUnavailableError vocabulary and hands back
 * the model's raw text (or null if the response shape was unexpected).
 * draftAgent owns parsing that text as JSON itself.
 */
async function generate(options: GenerateOptions): Promise<string | null> {
  let res: Response;
  try {
    res = await postJson(
      `${OLLAMA_URL}/api/generate`,
      {
        model: OLLAMA_MODEL,
        prompt: options.prompt,
        stream: false,
        format: options.format,
        keep_alive: KEEP_ALIVE,
        options: { num_predict: options.numPredict, temperature: options.temperature },
      },
      REQUEST_TIMEOUT_MS,
    );
  } catch (err) {
    throw new LocalLlmUnavailableError(
      err instanceof Error && err.name === "AbortError"
        ? "The local model took too long to respond."
        : `Couldn't reach the local model at ${OLLAMA_URL}.`,
    );
  }

  if (!res.ok) {
    // A 404 here is nearly always "that model isn't pulled yet", which is the
    // one failure a self-hoster can actually fix — so say it.
    throw new LocalLlmUnavailableError(
      res.status === 404
        ? `The local model "${OLLAMA_MODEL}" isn't installed. Run: ollama pull ${OLLAMA_MODEL}`
        : `The local model returned ${res.status}.`,
    );
  }

  const payload = (await res.json()) as OllamaGenerateResponse;
  return typeof payload.response === "string" ? payload.response : null;
}

/** Production LocalLlm backed by an Ollama sidecar. */
export function ollamaLocalLlm(): LocalLlm {
  return {
    async isAvailable() {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
      try {
        const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: controller.signal });
        if (!res.ok) return false;
        // A running Ollama with NO models pulled is the state a fresh install
        // is in, and it answers /api/tags perfectly happily — so "the server is
        // up" is the wrong question. Checking that the CONFIGURED model is
        // present is what stops the dashboard offering a wizard whose every
        // click 404s.
        const payload = (await res.json()) as { models?: unknown };
        if (!Array.isArray(payload.models)) return false;
        return payload.models.some((m) => {
          const name = (m as Record<string, unknown> | null)?.["name"];
          if (typeof name !== "string") return false;
          // Ollama reports "llama3.2:latest" for a model pulled as "llama3.2",
          // so compare on the pre-tag portion unless a tag was configured.
          return OLLAMA_MODEL.includes(":")
            ? name === OLLAMA_MODEL
            : name === OLLAMA_MODEL || name.startsWith(`${OLLAMA_MODEL}:`);
        });
      } catch {
        // Not configured, not running, wrong host — all the same answer to the
        // dashboard: don't offer the feature.
        return false;
      } finally {
        clearTimeout(timer);
      }
    },

    async draftAgent(description) {
      const text = await generate({
        prompt: buildPrompt(description),
        // Ollama's own constrained-decoding mode. Not a guarantee the CONTENT
        // is right (hence parseDraft), but it removes the most common failure
        // of a small model: prose wrapped around the JSON.
        format: "json",
        numPredict: NUM_PREDICT,
        // Low, not zero: this is structured extraction from a description,
        // not creative writing, and a small model left at its default
        // temperature wanders into inventing tool names — exactly what
        // readBlockedTools then has to throw away.
        temperature: 0.2,
      });
      if (text === null) return parseDraft(null);
      // format:"json" makes Ollama's `response` field itself a JSON document,
      // so it needs a second parse.
      try {
        return parseDraft(JSON.parse(text));
      } catch {
        return parseDraft(null);
      }
    },
  };
}

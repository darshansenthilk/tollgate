/**
 * Hosted-model Q&A for the PUBLIC install-wizard page (frontend marketing
 * site), where lib/local-llm.ts's Ollama sidecar structurally cannot help: a
 * visitor reading step-by-step download instructions hasn't installed
 * anything yet, has no Tollgate backend of their own running, and — even if
 * they'd already installed Ollama — a browser page on Tollgate's public
 * domain can't reach their local Ollama at all. Ollama refuses cross-origin
 * requests from any origin but localhost by default, specifically so a
 * random website can't silently use a visitor's local model; that's a
 * deliberate security boundary, not a gap to route around.
 *
 * HOSTED HERE ON PURPOSE, unlike local-llm.ts. The "never leaves the
 * customer's infrastructure" principle in that file protects CUSTOMER DATA —
 * an agent's prompts, a business's own descriptions. A stranger on the public
 * internet asking "how do I install Docker" before they've configured
 * anything has no such data at stake, so the constraint that ruled out a
 * hosted model there doesn't apply here. DeepSeek was picked specifically for
 * being inexpensive on an endpoint that's reachable by anyone with a browser
 * (see routes/install-wizard.ts's rate limit — that's the other half of
 * managing that exposure).
 *
 * The dashboard UI must say plainly that THIS assistant is hosted, not local
 * — a visitor who read about the local-only principle elsewhere shouldn't
 * have to guess which one this page uses.
 */
import { parseAnswerText } from "./answer-text.js";

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_URL = process.env.DEEPSEEK_URL ?? "https://api.deepseek.com/chat/completions";
/** Overridable because model names on hosted APIs get renamed/retired on the
 *  provider's schedule, not this codebase's — a config change should fix a
 *  stale default, not a redeploy. */
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash";

/** A hosted call on a public, unauthenticated endpoint has to stay cheap and
 *  fast per-request almost by definition — see the route's rate limit for the
 *  other half of bounding worst-case cost. */
const NUM_PREDICT = 250;
const REQUEST_TIMEOUT_MS = 20_000;

export class InstallWizardUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InstallWizardUnavailableError";
  }
}

export interface InstallWizardAssistant {
  /** Sync and free: whether DEEPSEEK_API_KEY is configured at all. Unlike
   *  local-llm.ts's isAvailable, this deliberately does NOT make a network
   *  call to verify — probing a paid api on every dashboard/page load would
   *  spend money just to decide whether to show a button. */
  isAvailable(): boolean;
  explain(question: string): Promise<string>;
}

function buildPrompt(question: string): string {
  return [
    "You help a visitor install Tollgate, a self-hosted spend-control proxy",
    "for AI agents, before they've installed anything yet. Answer in plain",
    "English, 2-4 sentences, no markdown. If you don't know, say so rather",
    "than guessing.",
    "",
    "Question:",
    question,
  ].join("\n");
}

interface DeepSeekResponse {
  choices?: { message?: { content?: unknown } }[];
}

/** Production InstallWizardAssistant backed by DeepSeek's OpenAI-compatible
 *  chat completions API. */
export function deepseekInstallWizardAssistant(): InstallWizardAssistant {
  return {
    isAvailable() {
      return DEEPSEEK_API_KEY !== undefined && DEEPSEEK_API_KEY.trim() !== "";
    },

    async explain(question) {
      if (DEEPSEEK_API_KEY === undefined || DEEPSEEK_API_KEY.trim() === "") {
        throw new InstallWizardUnavailableError("No DEEPSEEK_API_KEY is configured.");
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      let res: Response;
      try {
        res = await fetch(DEEPSEEK_URL, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${DEEPSEEK_API_KEY}`,
          },
          body: JSON.stringify({
            model: DEEPSEEK_MODEL,
            messages: [{ role: "user", content: buildPrompt(question) }],
            stream: false,
            max_tokens: NUM_PREDICT,
            temperature: 0.4,
          }),
          signal: controller.signal,
        });
      } catch (err) {
        throw new InstallWizardUnavailableError(
          err instanceof Error && err.name === "AbortError"
            ? "The install-wizard assistant took too long to respond."
            : "Couldn't reach the install-wizard assistant.",
        );
      } finally {
        clearTimeout(timer);
      }

      if (!res.ok) {
        // 401 here almost always means a missing/revoked key — distinct from
        // "the service is down", and the one failure an operator can actually
        // fix, so it's worth naming rather than folding into a generic error.
        throw new InstallWizardUnavailableError(
          res.status === 401
            ? "The install-wizard assistant's API key is missing or invalid."
            : `The install-wizard assistant returned ${res.status}.`,
        );
      }

      const payload = (await res.json()) as DeepSeekResponse;
      const content = payload.choices?.[0]?.message?.content;
      return (
        parseAnswerText(content) ?? "The assistant didn't return an answer — try rephrasing."
      );
    },
  };
}

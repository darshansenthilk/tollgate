/**
 * Shared bound on a free-text model answer, used by both assistants Tollgate
 * ships — the local one (lib/local-llm.ts, Ollama) and the hosted one
 * (lib/install-wizard-assistant.ts, DeepSeek). Split out here, rather than
 * living in either, specifically so the HOSTED client doesn't import from a
 * file named "local" — the naming would misdescribe what it's importing.
 *
 * Untrusted the same way parseDraft's fields are: a model's raw text is never
 * assumed well-formed. Never throws — an empty or unusable answer becomes
 * "no answer" for the caller to handle, not a crash.
 */

/** Independent of whatever num_predict/max_tokens bound the caller set on the
 *  request itself — this is the second, model-agnostic backstop so no
 *  caller's UI has to defend against an unbounded string. */
export const ANSWER_MAX_CHARS = 1_500;

export function parseAnswerText(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  return trimmed.length <= ANSWER_MAX_CHARS ? trimmed : trimmed.slice(0, ANSWER_MAX_CHARS) + "…";
}

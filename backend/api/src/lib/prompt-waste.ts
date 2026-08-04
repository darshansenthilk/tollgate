/**
 * Finds the static block an agent re-sends on every request.
 *
 * This is the cheapest large saving in most agent deployments: an app inlines
 * a catalog, a schema, or a policy document into every call, pays for those
 * tokens every time, and never notices because each individual request looks
 * small. Tollgate is the only thing that sees all of them, which is what makes
 * this detectable here and nowhere else.
 *
 * Deliberately NOT an LLM job. "The same 3KB appears in 94% of requests" is
 * string work — exact, cheap, and explainable. Handing it to a model would
 * make it slower, non-deterministic, and impossible to justify to a customer
 * asking why they're being told to change their app. The local model's role is
 * phrasing the recommendation, not finding it.
 */

/**
 * Minimum repeated length worth reporting, in characters. Below this the
 * finding is noise: every request to the same endpoint shares a short prefix
 * (`{"model":"gpt-4o-mini","messages":[{"role":...`) that no one can remove
 * because it IS the request format. ~500 chars is roughly 125 tokens — small
 * enough to catch a modest preamble, large enough that the advice is worth
 * acting on.
 */
export const MIN_BLOCK_CHARS = 500;

/** Fraction of sampled requests that must share the block before it's worth
 *  reporting. A block in half an agent's traffic is a real cost; one in 5% is
 *  a coincidence between two requests. */
export const MIN_FREQUENCY = 0.5;

/** Rough chars-per-token. Deliberately approximate and deliberately stated as
 *  such wherever it surfaces — an exact count needs the provider's tokenizer,
 *  and being wrong by 15% doesn't change the decision this informs. */
const CHARS_PER_TOKEN = 4;

export interface RepeatedBlock {
  /** The shared text itself, so the dashboard can show what to remove. */
  text: string;
  /** Share of sampled prompts containing it, 0..1. */
  frequency: number;
  /** Where it sits — a prefix is usually a system preamble, a suffix usually
   *  a trailing instruction block. Worth distinguishing because the fix
   *  differs: a preamble often moves to retrieval, a trailing instruction
   *  often just shortens. */
  position: "prefix" | "suffix";
}

function commonPrefixLength(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a[i] === b[i]) i++;
  return i;
}

function commonSuffixLength(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a[a.length - 1 - i] === b[b.length - 1 - i]) i++;
  return i;
}

/**
 * The longest prefix (or suffix) shared by at least MIN_FREQUENCY of the
 * sample.
 *
 * Uses the FIRST prompt as the reference and measures every other against it,
 * then takes the length that at least `MIN_FREQUENCY` of them reach. That's
 * deliberately not "the prefix common to ALL": one oddball request shouldn't
 * hide a block the other ninety-nine are paying for, which is exactly what a
 * strict intersection would do.
 */
function longestSharedRun(
  prompts: string[],
  measure: (a: string, b: string) => number,
): { length: number; frequency: number } {
  const reference = prompts[0];
  if (reference === undefined || prompts.length < 2) return { length: 0, frequency: 0 };

  const lengths = prompts.slice(1).map((p) => measure(reference, p));
  // Descending, so lengths[k] is the run length reached by at least k+1 others.
  lengths.sort((a, b) => b - a);

  let best = { length: 0, frequency: 0 };
  let bestScore = 0;
  for (let k = 0; k < lengths.length; k++) {
    const length = lengths[k] ?? 0;
    // k+1 others share it, plus the reference itself.
    const frequency = (k + 2) / prompts.length;
    if (frequency < MIN_FREQUENCY) continue;
    // Score on length × frequency, i.e. expected wasted tokens PER REQUEST —
    // not on length alone. Picking the longest run regardless of how many
    // requests carry it reports a slightly-longer block shared by half the
    // traffic over the slightly-shorter one shared by all of it, which
    // understates the real waste and points the customer at the wrong text.
    const score = length * frequency;
    if (score > bestScore) {
      bestScore = score;
      best = { length, frequency };
    }
  }
  return best;
}

/**
 * The largest static block this agent re-sends, or null when there isn't one
 * worth reporting.
 */
export function detectRepeatedBlock(prompts: string[]): RepeatedBlock | null {
  const usable = prompts.filter((p) => typeof p === "string" && p.length > 0);
  if (usable.length < 2) return null;

  const prefix = longestSharedRun(usable, commonPrefixLength);
  const suffix = longestSharedRun(usable, commonSuffixLength);
  const winner =
    prefix.length >= suffix.length
      ? { ...prefix, position: "prefix" as const }
      : { ...suffix, position: "suffix" as const };

  if (winner.length < MIN_BLOCK_CHARS) return null;

  const reference = usable[0]!;
  const text =
    winner.position === "prefix"
      ? reference.slice(0, winner.length)
      : reference.slice(reference.length - winner.length);

  return { text, frequency: winner.frequency, position: winner.position };
}

/** Approximate tokens in a string. See CHARS_PER_TOKEN on why this is a
 *  deliberate estimate rather than a real tokenizer count. */
export function estimateTokens(text: string): number {
  return Math.round(text.length / CHARS_PER_TOKEN);
}

/**
 * What this block plausibly costs over `requestCount` requests, in cents.
 *
 * Takes the input price rather than looking it up so this stays a pure
 * function — the caller already resolved the model to price the events it
 * read. Returns null when the model has no known price, because a confident
 * "$0.00 wasted" would be worse than admitting we can't say.
 */
export function estimateWasteCents(
  block: RepeatedBlock,
  requestCount: number,
  inputCentsPerMTok: number | null,
): number | null {
  if (inputCentsPerMTok === null) return null;
  const tokens = estimateTokens(block.text);
  const affectedRequests = requestCount * block.frequency;
  return (tokens * affectedRequests * inputCentsPerMTok) / 1_000_000;
}

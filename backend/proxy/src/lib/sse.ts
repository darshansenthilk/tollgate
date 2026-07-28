/**
 * Minimal server-sent-events reader, used to meter STREAMED upstream responses.
 *
 * Why this exists: the proxy buffers the whole upstream body and then meters
 * it. For a normal JSON response that's a single JSON.parse. For a streamed
 * response (`"stream": true`) the body is an SSE transcript, JSON.parse fails,
 * and — before this — metering silently returned a cost of 0. That made every
 * streamed request free as far as budgets were concerned, which defeats the
 * whole product. See the adapters' parseCost for how each provider's usage is
 * recovered from these frames.
 *
 * Deliberately not a full SSE implementation: we only need the JSON payload of
 * each `data:` frame, and both OpenAI and Anthropic emit one compact JSON
 * object per frame. Frames we can't parse are skipped rather than throwing —
 * a malformed or truncated stream should still meter whatever it did report.
 */

/** True if the body looks like an SSE transcript rather than a JSON document. */
export function looksLikeSse(raw: string): boolean {
  return /^\s*(event:|data:)/m.test(raw);
}

/**
 * Every `data:` payload in the transcript, JSON-parsed, in order.
 * OpenAI's terminal `data: [DONE]` sentinel is skipped (it isn't JSON).
 */
export function parseSseDataFrames(raw: string): unknown[] {
  const out: unknown[] = [];

  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice("data:".length).trim();
    if (payload === "" || payload === "[DONE]") continue;
    try {
      out.push(JSON.parse(payload));
    } catch {
      // Truncated or non-JSON frame — skip it, keep whatever else parsed.
    }
  }

  return out;
}

/** Narrow helper: read a nested property path off an unknown value. */
export function readPath(value: unknown, ...path: string[]): unknown {
  let cursor: unknown = value;
  for (const key of path) {
    if (typeof cursor !== "object" || cursor === null) return undefined;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return cursor;
}

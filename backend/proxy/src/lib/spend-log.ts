import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { SpendDecision } from "@tollgate/shared";

/**
 * A settled request to be written to the spend_events audit log. Written
 * asynchronously off the hot path — the caller must never await this on the
 * response.
 */
export interface SpendRecord {
  agentId: string;
  providerId: string;
  endpoint: string;
  method: string;
  estimatedCostCents: number | null;
  actualCostCents: number | null;
  decision: SpendDecision;
  /** Model the provider reported serving — null for denials (nothing ran) and
   *  for responses whose usage couldn't be parsed. */
  model: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  latencyMs: number | null;
  upstreamStatus: number | null;
  /**
   * The forwarded request body, so the dashboard's activity log can show what
   * an agent actually asked for. Null when nothing was forwarded (a denial
   * caught before the upstream call).
   *
   * Unlike the Redis current-prompt key this is PERSISTED — see the column's
   * doc comment in backend/api/src/db/schema.ts for the retention caveat that
   * comes with that.
   */
  prompt: string | null;
}

/**
 * Cap on a stored prompt. A request body has no size limit worth relying on,
 * and an agent pasting a whole document into every call would otherwise grow
 * spend_events without bound. Generous enough that a realistic prompt survives
 * intact; the marker below makes truncation visible rather than silent.
 */
const PROMPT_MAX_CHARS = 8_000;

const TRUNCATION_MARKER = "\n\n…[truncated by Tollgate]";

/** Bound a prompt for storage, marking it when anything was dropped so the
 *  activity log never implies it's showing the whole request when it isn't. */
export function truncatePrompt(prompt: string | undefined): string | null {
  if (prompt === undefined) return null;
  return prompt.length <= PROMPT_MAX_CHARS
    ? prompt
    : prompt.slice(0, PROMPT_MAX_CHARS) + TRUNCATION_MARKER;
}

/** Port for persisting spend events. Injected for testability. */
export interface SpendLog {
  record(event: SpendRecord): Promise<void>;
}

/** Production SpendLog backed by Postgres. */
export function pgSpendLog(pool: Pool): SpendLog {
  return {
    async record(event) {
      // Generate the idempotency key here so freeze-reconciliation has a stable
      // handle even when the agent didn't supply one.
      await pool.query(
        `INSERT INTO spend_events
           (id, agent_id, provider_id, endpoint, method,
            estimated_cost_cents, actual_cost_cents, decision,
            idempotency_key, latency_ms, upstream_status,
            model, prompt_tokens, completion_tokens, prompt)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [
          randomUUID(),
          event.agentId,
          event.providerId,
          event.endpoint,
          event.method,
          event.estimatedCostCents,
          event.actualCostCents,
          event.decision,
          randomUUID(),
          event.latencyMs,
          event.upstreamStatus,
          event.model,
          event.promptTokens,
          event.completionTokens,
          event.prompt,
        ],
      );
    },
  };
}

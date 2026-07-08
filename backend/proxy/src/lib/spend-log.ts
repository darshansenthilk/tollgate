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
  latencyMs: number | null;
  upstreamStatus: number | null;
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
            idempotency_key, latency_ms, upstream_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
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
        ],
      );
    },
  };
}

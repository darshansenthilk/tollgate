import { createHash } from "node:crypto";
import type { Pool } from "pg";
import type { AgentStatus } from "@tollgate/shared";

/**
 * What the hot path needs to know about the caller: identity, freeze state, and
 * the budget ceiling resolved from its policy. `maxBudgetCents` is null when the
 * agent has no policy or the policy sets no ceiling → treated as unlimited.
 */
export interface AuthedAgent {
  id: string;
  status: AgentStatus;
  maxBudgetCents: number | null;
  /** Descriptive assistant label the agent was created with (e.g. "chatgpt"). */
  providerSlug: string;
}

/** Tokens are never stored in the clear; we look agents up by SHA-256 hash. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Postgres-facing port the route depends on. Injected so tests can supply an
 * in-memory fake instead of a live database.
 */
export interface AgentStore {
  findByTokenHash(tokenHash: string): Promise<AuthedAgent | null>;
}

interface AgentRow {
  id: string;
  status: AgentStatus;
  max_budget_cents: number | null;
  provider_slug: string;
}

/** Production AgentStore backed by Postgres. */
export function pgAgentStore(pool: Pool): AgentStore {
  return {
    async findByTokenHash(tokenHash) {
      const result = await pool.query<AgentRow>(
        `SELECT a.id, a.status, a.provider_slug, p.max_budget_cents
           FROM agents a
           LEFT JOIN policies p ON p.id = a.policy_id
          WHERE a.token_hash = $1`,
        [tokenHash],
      );

      // noUncheckedIndexedAccess: rows[0] is AgentRow | undefined — check it.
      const row = result.rows[0];
      if (row === undefined) return null;

      return {
        id: row.id,
        status: row.status,
        maxBudgetCents: row.max_budget_cents,
        providerSlug: row.provider_slug,
      };
    },
  };
}

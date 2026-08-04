import { createHash } from "node:crypto";
import type { Pool } from "pg";
import type { AgentStatus, ToolDefinition } from "@tollgate/shared";

/**
 * What the hot path needs to know about the caller: identity, freeze state, and
 * the budget ceiling resolved from its policy. `maxBudgetCents` is null when the
 * agent has no policy or the policy sets no ceiling → treated as unlimited.
 */
export interface AuthedAgent {
  id: string;
  /**
   * Owning organization. Carried on the hot path because the vault is
   * org-scoped: which upstream key a request forwards with (the org's own BYOK
   * key, or Tollgate's shared fallback) is decided from this — see lib/vault.ts.
   * The agent's token is the ONLY thing that establishes it; it's read from the
   * agents row, never from anything the caller sends.
   */
  orgId: string;
  status: AgentStatus;
  maxBudgetCents: number | null;
  /** Descriptive assistant label the agent was created with (e.g. "chatgpt"). */
  providerSlug: string;
  /** Which stored BYOK key (org_upstream_keys.id) this agent forwards with, if
   *  any — null means no specific key chosen, so the vault falls straight
   *  through to the deployment's env key. See lib/vault.ts's doc comment. */
  upstreamKeyId: string | null;
  /** Tool/function names this agent's policy blocks — see
   *  Policy.blockedTools's doc comment. null = nothing blocked. */
  blockedTools: string[] | null;
  /** Prepended to every outgoing request — see Policy.systemPrompt's doc
   *  comment. null = nothing injected. */
  systemPrompt: string | null;
  /** Tools advertised in every outgoing request — see Policy.toolDefinitions's
   *  doc comment. null = nothing added. */
  toolDefinitions: ToolDefinition[] | null;
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
  org_id: string;
  status: AgentStatus;
  max_budget_cents: number | null;
  provider_slug: string;
  upstream_key_id: string | null;
  blocked_tools: string[] | null;
  system_prompt: string | null;
  tool_definitions: ToolDefinition[] | null;
}

/** Production AgentStore backed by Postgres. */
export function pgAgentStore(pool: Pool): AgentStore {
  return {
    async findByTokenHash(tokenHash) {
      const result = await pool.query<AgentRow>(
        `SELECT a.id, a.org_id, a.status, a.provider_slug, a.upstream_key_id,
                p.max_budget_cents, p.blocked_tools, p.system_prompt, p.tool_definitions
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
        orgId: row.org_id,
        status: row.status,
        maxBudgetCents: row.max_budget_cents,
        providerSlug: row.provider_slug,
        upstreamKeyId: row.upstream_key_id,
        blockedTools: row.blocked_tools,
        systemPrompt: row.system_prompt,
        toolDefinitions: row.tool_definitions,
      };
    },
  };
}

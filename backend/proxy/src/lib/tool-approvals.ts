import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { Redis } from "ioredis";
import { toolGrantKey } from "@tollgate/shared";

export { toolGrantKey };

/**
 * The escalation half of the tool gate: instead of a blocked tool call being a
 * dead end, the proxy checks whether an operator has already granted this one
 * and — if not — raises a request they can approve from the dashboard.
 *
 * Split across both stores on purpose. The GRANT is Redis (hot path, read on
 * every blocked call, TTL'd so an approval expires on its own); the REQUEST is
 * Postgres (an operator-facing queue that has to survive a Redis flush).
 *
 * The proxy only ever raises requests and reads grants — resolving a request
 * and writing a grant are the api's, so an agent can never approve itself.
 */
export interface ApprovalStore {
  /**
   * Atomically spend an operator's approval of this exact tool for this
   * agent, returning whether there was one to spend.
   *
   * Single-use, not a time window: approving "delete_customer, this once"
   * must not hand the agent a period in which it can delete five hundred
   * records. The grant still carries a TTL as a backstop so an approval
   * nobody acted on doesn't sit armed forever.
   */
  consumeGrant(agentId: string, toolName: string): Promise<boolean>;
  /** Raise a pending request for an operator to resolve. Idempotent: an agent
   *  retrying a blocked call in a loop must not flood the queue. */
  requestApproval(args: {
    orgId: string;
    agentId: string;
    toolName: string;
  }): Promise<void>;
}

/** Production ApprovalStore: grants in Redis, requests in Postgres. */
export function pgApprovalStore(pool: Pool, redis: Redis): ApprovalStore {
  return {
    async consumeGrant(agentId, toolName) {
      // DEL returns how many keys it removed, so this is one atomic
      // check-and-spend — two concurrent calls can't both redeem one
      // approval. (GETDEL would also work but needs Redis 6.2+; this
      // doesn't, and the value itself is never read.)
      return (await redis.del(toolGrantKey(agentId, toolName))) === 1;
    },

    async requestApproval({ orgId, agentId, toolName }) {
      // ON CONFLICT DO NOTHING against the partial unique index on
      // (agent_id, tool_name) WHERE status = 'pending' — see the table's doc
      // comment in backend/api/src/db/schema.ts. A resolved row doesn't
      // suppress a later re-request, which is what makes a denied escalation
      // re-raisable rather than permanently silenced.
      await pool.query(
        `INSERT INTO tool_approval_requests (id, org_id, agent_id, tool_name, status)
         VALUES ($1, $2, $3, $4, 'pending')
         ON CONFLICT DO NOTHING`,
        [randomUUID(), orgId, agentId, toolName],
      );
    },
  };
}

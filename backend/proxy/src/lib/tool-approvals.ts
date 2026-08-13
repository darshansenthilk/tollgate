import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { Redis } from "ioredis";
import { toolGrantKey, type ApprovalStore } from "@tollgate/shared";

export { toolGrantKey, type ApprovalStore };

/** Production ApprovalStore: grants in Redis, requests in Postgres. The
 *  interface itself now lives in @tollgate/shared — see its doc comment for
 *  why (routes/mcp.ts's tool-call gate needs to type against it too, without
 *  depending on this file). */
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

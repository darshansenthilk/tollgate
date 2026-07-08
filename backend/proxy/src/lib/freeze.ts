import type { Redis } from "ioredis";
import { freezeKey } from "@tollgate/shared";

export { freezeKey };

/**
 * Redis-backed fast-path freeze check. Postgres `agents.status` (checked in
 * agents.ts on every request already) remains the system of record — this is
 * an additional, redundant check that the api's freeze/unfreeze endpoints
 * update in the same request, so a frozen agent is denied even if something
 * about the Postgres read were ever stale or degraded.
 */
export interface FreezeStore {
  isFrozen(agentId: string): Promise<boolean>;
}

/** Production FreezeStore backed by a real Redis connection. */
export function redisFreezeStore(redis: Redis): FreezeStore {
  return {
    async isFrozen(agentId) {
      const value = await redis.get(freezeKey(agentId));
      return value !== null;
    },
  };
}

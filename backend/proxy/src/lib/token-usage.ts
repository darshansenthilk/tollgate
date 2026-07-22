import type { Redis } from "ioredis";
import { tokenKey } from "@tollgate/shared";

export { tokenKey };

/**
 * Token-count counter — same atomic-INCRBY shape as BudgetStore (budget.ts),
 * but a separate store/key so LLM token usage and dollar spend are
 * independent counters: an adapter can report one without the other (see
 * ProviderCost in @tollgate/shared).
 */
export interface TokenUsageStore {
  /** Atomically add tokens and return the new total. */
  addTokens(key: string, deltaTokens: number): Promise<number>;
}

/** Production TokenUsageStore backed by a real Redis connection. */
export function redisTokenUsageStore(redis: Redis): TokenUsageStore {
  return {
    async addTokens(key, deltaTokens) {
      return redis.incrby(key, deltaTokens);
    },
  };
}

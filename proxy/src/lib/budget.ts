import type { Redis } from "ioredis";

// Re-exported so existing import sites (routes/proxy.ts, tests) don't need to
// change; the implementations live in @tollgate/shared so proxy and api derive
// byte-identical keys.
export {
  MICROCENTS_PER_CENT,
  centsToMicroCents,
  currentMonth,
  spendKey,
} from "@tollgate/shared";

/**
 * The slice of Redis the hot path needs. Injected so the route can be tested
 * against an in-memory fake without standing up Redis.
 */
export interface BudgetStore {
  /** Current spend for the key, in micro-cents (0 if the key is unset). */
  getSpendMicroCents(key: string): Promise<number>;
  /** Atomically add micro-cents and return the new total. */
  addSpendMicroCents(key: string, deltaMicroCents: number): Promise<number>;
}

/** Production BudgetStore backed by a real Redis connection. */
export function redisBudgetStore(redis: Redis): BudgetStore {
  return {
    async getSpendMicroCents(key) {
      const raw = await redis.get(key);
      if (raw === null) return 0;
      const parsed = Number.parseInt(raw, 10);
      return Number.isNaN(parsed) ? 0 : parsed;
    },
    async addSpendMicroCents(key, deltaMicroCents) {
      // INCRBY is atomic: concurrent requests for the same agent can't lose a
      // write or read a torn value.
      return redis.incrby(key, deltaMicroCents);
    },
  };
}

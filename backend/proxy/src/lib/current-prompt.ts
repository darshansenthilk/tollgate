import type { Redis } from "ioredis";
import { currentPromptKey } from "@tollgate/shared";

export { currentPromptKey };

/** ~2 minutes — long enough to catch a slow request in the sidebar, short
 *  enough that "current" doesn't quietly lie once the agent goes idle. */
const CURRENT_PROMPT_TTL_SECONDS = 120;

/**
 * Transient "what's happening right now" state for the dashboard sidebar.
 * Written by the proxy before forwarding, with a short TTL, and never read
 * back by the proxy itself (only the api reads it, the same way it reads the
 * spend/token counters).
 *
 * This key is still Redis-only — but note that the request body IS separately
 * persisted per event on spend_events.prompt, for the activity log's
 * drill-in. So "the prompt never reaches Postgres" is no longer true of the
 * system as a whole; it's true of this key.
 */
export interface CurrentPromptStore {
  setCurrentPrompt(agentId: string, prompt: string): Promise<void>;
}

/** Production CurrentPromptStore backed by a real Redis connection. */
export function redisCurrentPromptStore(redis: Redis): CurrentPromptStore {
  return {
    async setCurrentPrompt(agentId, prompt) {
      await redis.set(currentPromptKey(agentId), prompt, "EX", CURRENT_PROMPT_TTL_SECONDS);
    },
  };
}

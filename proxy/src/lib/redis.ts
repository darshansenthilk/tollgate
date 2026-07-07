import { Redis } from "ioredis";
import type { DependencyHealth } from "@tollgate/shared";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

export const redis = new Redis(REDIS_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
});

redis.on("error", () => {
  /* surfaced via /health; don't crash the process on transient blips */
});

export async function checkRedis(): Promise<DependencyHealth> {
  const start = performance.now();
  try {
    if (redis.status !== "ready") await redis.connect().catch(() => {});
    const pong = await redis.ping();
    return {
      state: pong === "PONG" ? "ok" : "error",
      latencyMs: Math.round(performance.now() - start),
    };
  } catch (err) {
    return {
      state: "error",
      latencyMs: Math.round(performance.now() - start),
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

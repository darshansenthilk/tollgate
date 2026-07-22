import "./lib/env.js";
import Fastify from "fastify";
import type { HealthReport } from "@tollgate/shared";
import { redis, checkRedis } from "./lib/redis.js";
import { pool, checkPostgres } from "./lib/db.js";
import { providers } from "./adapters/registry.js";
import { pgAgentStore } from "./lib/agents.js";
import { redisBudgetStore } from "./lib/budget.js";
import { pgSpendLog } from "./lib/spend-log.js";
import { envVault } from "./lib/vault.js";
import { redisFreezeStore } from "./lib/freeze.js";
import { redisTokenUsageStore } from "./lib/token-usage.js";
import { redisCurrentPromptStore } from "./lib/current-prompt.js";
import { registerProxyRoute } from "./routes/proxy.js";

const PORT = Number(process.env.PROXY_PORT ?? 8080);
const startedAt = Date.now();

const app = Fastify({ logger: true });

/**
 * Proof of life: verifies this service can reach Redis (enforcement hot path)
 * and Postgres (system of record). Also increments a heartbeat counter in
 * Redis so a round-trip write is exercised, not just PING.
 */
app.get("/health", async (_req, reply): Promise<HealthReport> => {
  const [redisHealth, pgHealth] = await Promise.all([checkRedis(), checkPostgres()]);

  if (redisHealth.state === "ok") {
    await redis.incr("tollgate:proxy:heartbeat").catch(() => {});
  }

  const ok = redisHealth.state === "ok" && pgHealth.state === "ok";
  reply.code(ok ? 200 : 503);
  return {
    service: "proxy",
    ok,
    uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    timestamp: new Date().toISOString(),
    redis: redisHealth,
    postgres: pgHealth,
  };
});

/**
 * Data plane: agents call POST /:providerSlug/* with a Tollgate token; the proxy
 * authenticates, checks the Redis budget, forwards upstream with the vaulted key,
 * meters the response, and settles spend. All provider specifics live behind the
 * adapter registry — this wiring names no provider.
 */
registerProxyRoute(app, {
  registry: providers,
  agents: pgAgentStore(pool),
  budget: redisBudgetStore(redis),
  spendLog: pgSpendLog(pool),
  vault: envVault(),
  freeze: redisFreezeStore(redis),
  tokenUsage: redisTokenUsageStore(redis),
  currentPrompt: redisCurrentPromptStore(redis),
  fetchImpl: fetch,
  now: () => new Date(),
});

async function main() {
  await app.listen({ port: PORT, host: "0.0.0.0" });
}

async function shutdown() {
  await app.close();
  await redis.quit().catch(() => {});
  await pool.end().catch(() => {});
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

main().catch((err) => {
  app.log.error(err);
  process.exit(1);
});

import "dotenv/config";
import Fastify from "fastify";
import type { HealthReport } from "@tollgate/shared";
import { redis, checkRedis } from "./lib/redis.js";
import { pool, checkPostgres } from "./lib/db.js";

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
 * Future data plane: agents call /:providerSlug/* with a Tollgate token; the
 * proxy evaluates policy from Redis, forwards upstream with the vaulted key,
 * meters the response, and settles spend. Not implemented in this milestone.
 */
app.all("/:providerSlug/*", async (req, reply) => {
  reply.code(501);
  return {
    error: "not_implemented",
    message:
      "Tollgate proxy is running, but request forwarding lands in a later milestone.",
    received: { method: req.method, url: req.url },
  };
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

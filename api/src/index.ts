import "./lib/env.js";
import Fastify from "fastify";
import cors from "@fastify/cors";
import type { HealthReport } from "@tollgate/shared";
import { redis, checkRedis } from "./lib/redis.js";
import { checkPostgres, pool } from "./lib/db.js";
import { registerStubRoutes } from "./routes/stubs.js";
import { registerAgentRoutes } from "./routes/agents.js";
import { runMigrations } from "./db/migrate.js";

const PORT = Number(process.env.API_PORT ?? 4000);
const startedAt = Date.now();

const app = Fastify({ logger: true });

await app.register(cors, { origin: true }); // tighten before any real deployment

app.get("/health", async (_req, reply): Promise<HealthReport> => {
  const [redisHealth, pgHealth] = await Promise.all([checkRedis(), checkPostgres()]);

  if (redisHealth.state === "ok") {
    await redis.incr("tollgate:api:heartbeat").catch(() => {});
  }

  const ok = redisHealth.state === "ok" && pgHealth.state === "ok";
  reply.code(ok ? 200 : 503);
  return {
    service: "api",
    ok,
    uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    timestamp: new Date().toISOString(),
    redis: redisHealth,
    postgres: pgHealth,
  };
});

registerStubRoutes(app);
registerAgentRoutes(app, redis);

async function main() {
  try {
    await runMigrations();
    app.log.info("postgres migrations applied");
  } catch (err) {
    // Don't crash: /health will report the Postgres failure with detail, and
    // routes that hit missing tables will surface it per-request.
    app.log.warn({ err }, "postgres migration failed; continuing");
  }
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

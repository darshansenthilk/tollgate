import "./lib/env.js";
import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import type { HealthReport } from "@tollgate/shared";
import { redis, checkRedis } from "./lib/redis.js";
import { checkPostgres, pool } from "./lib/db.js";
import { registerStubRoutes } from "./routes/stubs.js";
import { registerAgentRoutes } from "./routes/agents.js";
import { registerUpstreamKeyRoutes } from "./routes/upstream-keys.js";
import { registerActivityRoutes } from "./routes/activity.js";
import { registerDashboardRoutes } from "./routes/dashboards.js";
import { registerAuthRoutes } from "./lib/auth-mount.js";
import { requireAuth } from "./lib/require-auth.js";
import { runMigrations } from "./db/migrate.js";
import { runAuthMigrations } from "./db/auth-migrate.js";

const PORT = Number(process.env.API_PORT ?? 4000);
const DASHBOARD_ORIGIN = process.env.DASHBOARD_ORIGIN ?? "http://localhost:3000";
const startedAt = Date.now();

const app = Fastify({ logger: true });

// Security headers on every response. CSP is off (this service returns JSON /
// auth responses, not HTML), and CORP is cross-origin so the dashboard on
// another origin can read responses — CORS below governs exactly who that is.
await app.register(helmet, {
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" },
  crossOriginEmbedderPolicy: false,
});

// CORS locked to the dashboard origin, credentials enabled so the Better Auth
// session cookie is accepted cross-origin (dashboard :3000 -> api :4000 are the
// same site). A wildcard origin is invalid with credentials anyway.
await app.register(cors, { origin: [DASHBOARD_ORIGIN], credentials: true });

// Global rate limit across the whole api. Better Auth adds a second, stricter
// limiter on its own /api/auth/* surface (see lib/auth.ts).
await app.register(rateLimit, { max: 300, timeWindow: "1 minute" });

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

// Better Auth owns /api/auth/* — public, because it IS the auth surface.
await registerAuthRoutes(app);

// The management plane (agent CRUD + policy stubs) is gated: requireAuth 401s
// anonymous callers and scopes each request to the caller's active org. /health
// and /api/auth/* stay outside this encapsulated scope, so they're unaffected.
await app.register(async (scope) => {
  scope.addHook("preHandler", requireAuth);
  registerStubRoutes(scope);
  registerAgentRoutes(scope, redis);
  registerUpstreamKeyRoutes(scope);
  registerActivityRoutes(scope);
  registerDashboardRoutes(scope);
});

async function main() {
  try {
    await runMigrations();
    app.log.info("postgres migrations applied");
    await runAuthMigrations();
    app.log.info("better-auth migrations applied");
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

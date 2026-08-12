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
import { registerApprovalRoutes } from "./routes/approvals.js";
import { registerAgentDraftRoutes } from "./routes/agent-draft.js";
import { registerSuggestionRoutes } from "./routes/suggestions.js";
import { registerDashboardRoutes } from "./routes/dashboards.js";
import { registerInstallWizardRoutes } from "./routes/install-wizard.js";
import { registerAuthCapabilityRoutes } from "./routes/auth-capabilities.js";
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

// Public and unauthenticated, same as /health above and unlike everything in
// the requireAuth scope below — a visitor reading the marketing site's
// install steps hasn't signed up for anything yet. See routes/install-wizard.ts.
registerInstallWizardRoutes(app);

// Also public, and for the same reason: the sign-in page asks which sign-in
// methods this deployment offers (self-hosted builds may add SSO), and it has
// no session yet by definition. See routes/auth-capabilities.ts.
registerAuthCapabilityRoutes(app);

// The management plane (agent CRUD + policy stubs) is gated: requireAuth 401s
// anonymous callers and scopes each request to the caller's active org. /health
// and /api/auth/* stay outside this encapsulated scope, so they're unaffected.
await app.register(async (scope) => {
  scope.addHook("preHandler", requireAuth);
  registerStubRoutes(scope);
  registerAgentRoutes(scope, redis);
  registerUpstreamKeyRoutes(scope);
  registerActivityRoutes(scope);
  registerApprovalRoutes(scope, redis);
  // "/v1/agents/draft" coexists with registerAgentRoutes' "/v1/agents/:id"
  // above: Fastify's radix router prefers a static segment over a parametric
  // one no matter which was registered first, so "draft" is never swallowed as
  // an :id. Worth stating because the safety here is the router's, not the
  // ordering's — moving these calls around cannot break it, but renaming
  // "draft" to something an id could collide with would.
  registerAgentDraftRoutes(scope);
  registerSuggestionRoutes(scope);
  registerDashboardRoutes(scope, redis);
});

async function main() {
  try {
    // Better Auth FIRST, and the order is load-bearing on a fresh database:
    // 0012_zippy_power_man.sql backfills dashboards.created_by by reading
    // Better Auth's "member" table (org_id is plain text, so it reaches across
    // by value rather than by FK). Run drizzle first and that UPDATE hits a
    // table that doesn't exist yet — 42P01.
    //
    // The damage is total, not partial: drizzle's migrator runs the whole
    // chain in ONE transaction, so 0012 failing rolls 0000–0011 back out with
    // it, and the throw skips runAuthMigrations() below, so Better Auth's
    // tables are never created either. The catch then downgrades all of that
    // to a warning and the api listens anyway — on an EMPTY database.
    // (Measured, not reasoned: replaying each order into a scratch database
    // gives 18 applied migrations this way round and 0 the other.)
    //
    // Both migrators are idempotent and nothing Better Auth creates depends on
    // an app table, so this direction has no cost on an existing database.
    await runAuthMigrations();
    app.log.info("better-auth migrations applied");
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

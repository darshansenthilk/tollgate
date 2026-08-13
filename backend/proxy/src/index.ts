import "./lib/env.js";
import Fastify from "fastify";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import type { HealthReport } from "@tollgate/shared";
import { redis, checkRedis } from "./lib/redis.js";
import { pool, checkPostgres } from "./lib/db.js";
import { providers, assistantAdapterSlugs } from "./adapters/registry.js";
import { pgAgentStore } from "./lib/agents.js";
import { redisBudgetStore } from "./lib/budget.js";
import { pgSpendLog } from "./lib/spend-log.js";
import { pgVault } from "./lib/vault.js";
import { redisFreezeStore } from "./lib/freeze.js";
import { redisTokenUsageStore } from "./lib/token-usage.js";
import { redisCurrentPromptStore } from "./lib/current-prompt.js";
import { pgApprovalStore } from "./lib/tool-approvals.js";
import { registerProxyRoute } from "./routes/proxy.js";
import { registerInternalConnectorRoutes } from "./routes/internal-connectors.js";
import { registerMcpGatewayRoute } from "./routes/mcp.js";

const PORT = Number(process.env.PROXY_PORT ?? 8080);
const startedAt = Date.now();

// Fastify's default bodyLimit is 1MB, silently 413ing any real multimodal
// payload (a PDF/image/audio attachment) long before it reaches an adapter
// or an upstream provider's own limit — discovered via a real request:
// Anthropic's Messages API accepts documents up to 32MB, and a legitimately
// chunked, correctly-sized request was still rejected here. Set with
// headroom above that real, largest-known provider cap rather than pinned
// exactly to it.
const app = Fastify({ logger: true, bodyLimit: 40 * 1024 * 1024 });

// Security-header hygiene. The proxy is a server-to-server data plane (agents
// call it with a Tollgate token), not browser-facing, so no CORS. A generous
// flood cap sits above the real controls — per-agent token auth + budgets in
// registerProxyRoute — rather than throttling legitimate agent throughput.
await app.register(helmet);
await app.register(rateLimit, { max: 1000, timeWindow: "1 minute" });

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

// Shared across registerProxyRoute and registerInternalConnectorRoutes — one
// vault instance, one onDecryptFailure alarm, whether the caller is a
// proxied LLM request or an internal connector poll.
const vault = pgVault(pool, {
  onDecryptFailure: (orgId, slug) => {
    app.log.error(
      { orgId, slug },
      "stored upstream key could not be decrypted — check VAULT_ENCRYPTION_KEY matches the api service; requests for this org/provider are being denied",
    );
  },
});

/**
 * Data plane: agents call POST /:providerSlug/* with a Tollgate token; the proxy
 * authenticates, checks the agent's declared assistant against the resolved
 * adapter, checks the Redis budget, forwards upstream with the vaulted key,
 * meters the response, and settles spend. Adapter dispatch itself stays
 * provider-agnostic (the registry); assistantAdapterSlugs is the one place
 * that names the real integrations, kept out of the route handler.
 */
registerProxyRoute(app, {
  registry: providers,
  agents: pgAgentStore(pool),
  budget: redisBudgetStore(redis),
  spendLog: pgSpendLog(pool),
  // Org-scoped: a BYOK org's own provider key, else Tollgate's env key.
  // A stored-but-undecryptable key denies the request (see lib/vault.ts) —
  // loud, because it silently breaks every request for that org.
  vault,
  freeze: redisFreezeStore(redis),
  tokenUsage: redisTokenUsageStore(redis),
  currentPrompt: redisCurrentPromptStore(redis),
  // Grants live in Redis (hot path), the operator-facing request queue in
  // Postgres — see lib/tool-approvals.ts.
  approvals: pgApprovalStore(pool, redis),
  fetchImpl: fetch,
  now: () => new Date(),
  assistantAdapterSlugs,
});

// Internal-only: api's usage pollers (external agent governance) call these
// to decrypt a platform-connector credential and make the real outbound call
// server-side — see routes/internal-connectors.ts's doc comment for why this
// exists instead of giving api its own decrypt function.
registerInternalConnectorRoutes(app, { vault, fetchImpl: fetch });

// The other half of external agent governance: agents hosted on a platform
// Tollgate can't intercept LLM traffic for (Anthropic Managed Agents,
// Salesforce Agentforce) are instead pointed at this as their MCP tool
// server — see routes/mcp.ts's doc comment for the full design.
registerMcpGatewayRoute(app, {
  agents: pgAgentStore(pool),
  vault,
  approvals: pgApprovalStore(pool, redis),
  spendLog: pgSpendLog(pool),
  fetchImpl: fetch,
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

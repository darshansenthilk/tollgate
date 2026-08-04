import type { FastifyInstance } from "fastify";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../db/client.js";
import { agents, dashboards, spendEvents } from "../db/schema.js";
import { resolveDashboardId, UUID_RE } from "../lib/dashboard-scope.js";

/**
 * The activity feed behind the dashboard's log panel: every request one
 * dashboard's agents made, allowed or denied, newest first.
 *
 * Scoped by joining through agents and filtering on the caller's active org —
 * spend_events itself carries no org_id, so the join IS the isolation boundary.
 * Gated by the requireAuth preHandler (index.ts) like every other /v1 route,
 * which is why the `!` on req.activeOrgId is safe.
 *
 * The feed is scoped to ONE dashboard for the same reason /v1/agents is: it's
 * derived from agents, so an org-wide feed would list agents from dashboards the
 * caller isn't looking at — naming them, and their spend, right there in the
 * table. Independent dashboards have to mean independent here too.
 */

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

function parseLimit(raw: unknown): number {
  if (typeof raw !== "string") return DEFAULT_LIMIT;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

export function registerActivityRoutes(app: FastifyInstance): void {
  app.get<{ Querystring: { limit?: string; dashboardId?: string } }>(
    "/v1/activity",
    async (req, reply) => {
    const orgId = req.activeOrgId!;
    const limit = parseLimit(req.query.limit);

    const scope = await resolveDashboardId(req.query.dashboardId, orgId);
    if (!scope.ok) {
      reply.code(scope.error === "dashboard_id_required" ? 400 : 404);
      return { error: scope.error };
    }

    const rows = await db
      .select({
        id: spendEvents.id,
        agentId: spendEvents.agentId,
        agentName: agents.name,
        /** The agent's assistant label ("chatgpt"/"claude") — the consumer-facing
         *  vocabulary, not spend_events.providerId's adapter slug. */
        assistant: agents.providerSlug,
        model: spendEvents.model,
        endpoint: spendEvents.endpoint,
        decision: spendEvents.decision,
        actualCostCents: spendEvents.actualCostCents,
        promptTokens: spendEvents.promptTokens,
        completionTokens: spendEvents.completionTokens,
        upstreamStatus: spendEvents.upstreamStatus,
        latencyMs: spendEvents.latencyMs,
        /** What the agent actually asked — see the column's doc comment in
         *  db/schema.ts for the retention caveat that comes with storing it. */
        prompt: spendEvents.prompt,
        createdAt: spendEvents.createdAt,
      })
      .from(spendEvents)
      .innerJoin(agents, eq(agents.id, spendEvents.agentId))
      // orgId is kept alongside dashboardId for the same defence-in-depth reason
      // GET /v1/agents keeps it — see that route's comment.
      .where(and(eq(agents.dashboardId, scope.dashboardId), eq(agents.orgId, orgId)))
      .orderBy(desc(spendEvents.createdAt))
      .limit(limit);

    return rows.map((row) => ({
      id: row.id,
      agentId: row.agentId,
      agentName: row.agentName,
      assistant: row.assistant,
      // Falls back to the descriptive label only when the provider didn't
      // report one (denials, unparseable usage) — never silently substitutes.
      model: row.model,
      endpoint: row.endpoint,
      decision: row.decision,
      // numeric columns come back as strings from pg; normalize to a number so
      // the dashboard isn't doing string math on money.
      costCents: row.actualCostCents === null ? null : Number(row.actualCostCents),
      promptTokens: row.promptTokens,
      completionTokens: row.completionTokens,
      totalTokens:
        row.promptTokens === null && row.completionTokens === null
          ? null
          : (row.promptTokens ?? 0) + (row.completionTokens ?? 0),
      upstreamStatus: row.upstreamStatus,
      latencyMs: row.latencyMs,
      prompt: row.prompt,
      createdAt: row.createdAt.toISOString(),
    }));
    },
  );

  /** Same feed narrowed to one agent — powers a per-agent drill-in later; also
   *  keeps the org scoping in one place rather than duplicating the join. */
  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>(
    "/v1/agents/:id/activity",
    async (req, reply) => {
      const orgId = req.activeOrgId!;
      const limit = parseLimit(req.query.limit);

      // `agents.id` is a uuid column, so a malformed id would otherwise reach
      // Postgres as a 22P02 cast error and — with no setErrorHandler registered
      // anywhere in the api — come back as a 500 carrying the raw pg driver
      // message instead of the 404 this route documents.
      if (!UUID_RE.test(req.params.id)) {
        reply.code(404);
        return { error: "agent_not_found" };
      }

      // The dashboard join is an access check, not a data change. A deleted
      // dashboard's request log — agent names, models, per-request costs — stayed
      // fully readable by agent id without it, since this route has no dashboard
      // scoping of its own. The spend_events rows themselves are untouched and
      // stay in Postgres for billing; being reachable through the app is the half
      // that has to look deleted.
      const owned = await db
        .select({ id: agents.id })
        .from(agents)
        .innerJoin(dashboards, eq(dashboards.id, agents.dashboardId))
        .where(
          and(
            eq(agents.id, req.params.id),
            eq(agents.orgId, orgId),
            isNull(dashboards.archivedAt),
          ),
        );

      if (owned.length === 0) {
        reply.code(404);
        return { error: "agent_not_found" };
      }

      const rows = await db
        .select({
          id: spendEvents.id,
          model: spendEvents.model,
          endpoint: spendEvents.endpoint,
          decision: spendEvents.decision,
          actualCostCents: spendEvents.actualCostCents,
          promptTokens: spendEvents.promptTokens,
          completionTokens: spendEvents.completionTokens,
          upstreamStatus: spendEvents.upstreamStatus,
          latencyMs: spendEvents.latencyMs,
          createdAt: spendEvents.createdAt,
        })
        .from(spendEvents)
        .where(eq(spendEvents.agentId, req.params.id))
        .orderBy(desc(spendEvents.createdAt))
        .limit(limit);

      return rows.map((row) => ({
        id: row.id,
        model: row.model,
        endpoint: row.endpoint,
        decision: row.decision,
        costCents: row.actualCostCents === null ? null : Number(row.actualCostCents),
        promptTokens: row.promptTokens,
        completionTokens: row.completionTokens,
        totalTokens:
          row.promptTokens === null && row.completionTokens === null
            ? null
            : (row.promptTokens ?? 0) + (row.completionTokens ?? 0),
        upstreamStatus: row.upstreamStatus,
        latencyMs: row.latencyMs,
        createdAt: row.createdAt.toISOString(),
      }));
    },
  );
}

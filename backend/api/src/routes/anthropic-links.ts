import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { and, eq, isNull, ne } from "drizzle-orm";
import { agents, anthropicManagedAgentLinks, dashboards, orgUpstreamKeys } from "../db/schema.js";
import { db } from "../db/client.js";
import { dashboardAccessible, UUID_RE } from "../lib/dashboard-scope.js";
import { canPerformDashboardAction } from "../lib/dashboard-permissions.js";

/**
 * CRUD for an agent's Anthropic Managed Agents link (Phase 2/4 of external
 * agent governance — see the approved plan at
 * .claude/plans/dapper-greeting-flame.md). One row per agent, 1:1, holding
 * the real Anthropic identifiers backend/api/src/connectors's poller needs:
 * which stored "anthropic-admin" credential to decrypt, which real Anthropic
 * API key id to filter the usage report by, and (optional, for Phase 4's
 * native budget delegation) which live Managed Agents session id to update.
 *
 * Session discovery is deliberately manual entry, not auto-discovered via
 * GET /v1/sessions — that listing's real filter semantics weren't confirmed
 * against a live account while building this, and guessing at them would
 * risk silently linking the wrong session. The operator pastes the id they
 * already have from creating the session themselves.
 */

async function findAgentForLink(
  id: string,
  orgId: string,
  userId: string,
): Promise<{
  id: string;
  orgId: string;
  hostPlatform: string | null;
  dashboardId: string;
  dashboardOrgId: string;
} | null> {
  if (!UUID_RE.test(id)) return null;

  const rows = await db
    .select({
      id: agents.id,
      orgId: agents.orgId,
      hostPlatform: agents.hostPlatform,
      dashboardId: agents.dashboardId,
      dashboardOrgId: dashboards.orgId,
    })
    .from(agents)
    .innerJoin(dashboards, eq(dashboards.id, agents.dashboardId))
    .where(
      and(
        eq(agents.id, id),
        dashboardAccessible(orgId, userId),
        ne(agents.status, "archived"),
        isNull(dashboards.archivedAt),
      ),
    );

  return rows[0] ?? null;
}

async function upstreamKeyBelongsToAnthropicAdmin(upstreamKeyId: string, orgId: string): Promise<boolean> {
  const rows = await db
    .select({ id: orgUpstreamKeys.id })
    .from(orgUpstreamKeys)
    .where(
      and(
        eq(orgUpstreamKeys.id, upstreamKeyId),
        eq(orgUpstreamKeys.orgId, orgId),
        eq(orgUpstreamKeys.providerSlug, "anthropic-admin"),
      ),
    );
  return rows.length > 0;
}

interface LinkBody {
  anthropicApiKeyId: string;
  anthropicWorkspaceId: string | null;
  currentSessionId: string | null;
  upstreamKeyId: string | null;
}

type ParseResult = { ok: true; body: LinkBody } | { ok: false; error: string };

function parseLinkBody(body: unknown): ParseResult {
  if (typeof body !== "object" || body === null) return { ok: false, error: "invalid_body" };
  const rec = body as Record<string, unknown>;

  const anthropicApiKeyId = rec["anthropicApiKeyId"];
  if (typeof anthropicApiKeyId !== "string" || anthropicApiKeyId.trim() === "") {
    return { ok: false, error: "invalid_body" };
  }

  function optionalString(value: unknown): string | null | undefined {
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (typeof value === "string" && value.trim() !== "") return value.trim();
    return undefined;
  }

  const anthropicWorkspaceId = optionalString(rec["anthropicWorkspaceId"]) ?? null;
  const currentSessionId = optionalString(rec["currentSessionId"]) ?? null;
  const upstreamKeyId = optionalString(rec["upstreamKeyId"]) ?? null;

  return {
    ok: true,
    body: {
      anthropicApiKeyId: anthropicApiKeyId.trim(),
      anthropicWorkspaceId,
      currentSessionId,
      upstreamKeyId,
    },
  };
}

export function registerAnthropicLinkRoutes(app: FastifyInstance): void {
  app.get<{ Params: { id: string } }>("/v1/agents/:id/anthropic-link", async (req, reply) => {
    const orgId = req.activeOrgId!;
    const agent = await findAgentForLink(req.params.id, orgId, req.authUser!.id);
    if (agent === null) {
      reply.code(404);
      return { error: "agent_not_found" };
    }

    const [row] = await db
      .select()
      .from(anthropicManagedAgentLinks)
      .where(eq(anthropicManagedAgentLinks.agentId, agent.id));

    if (row === undefined) return { link: null };
    return {
      link: {
        anthropicApiKeyId: row.anthropicApiKeyId,
        anthropicWorkspaceId: row.anthropicWorkspaceId,
        currentSessionId: row.currentSessionId,
        upstreamKeyId: row.upstreamKeyId,
        lastPolledAt: row.lastPolledAt === null ? null : row.lastPolledAt.toISOString(),
      },
    };
  });

  app.put<{ Params: { id: string }; Body: unknown }>(
    "/v1/agents/:id/anthropic-link",
    async (req, reply) => {
      const orgId = req.activeOrgId!;
      const agent = await findAgentForLink(req.params.id, orgId, req.authUser!.id);
      if (agent === null) {
        reply.code(404);
        return { error: "agent_not_found" };
      }
      if (agent.hostPlatform !== "anthropic_managed_agents") {
        reply.code(400);
        return {
          error: "wrong_host_platform",
          message: "This agent isn't hosted on Anthropic Managed Agents.",
        };
      }
      if (
        !(await canPerformDashboardAction(
          agent.dashboardId,
          agent.dashboardOrgId,
          orgId,
          req.authUser!.id,
          "updateAgent",
        ))
      ) {
        reply.code(403);
        return {
          error: "dashboard_permission_denied",
          message: "Your role doesn't allow editing agents on this dashboard.",
        };
      }

      const parsed = parseLinkBody(req.body);
      if (!parsed.ok) {
        reply.code(400);
        return { error: parsed.error };
      }
      const body = parsed.body;

      if (
        body.upstreamKeyId !== null &&
        !(await upstreamKeyBelongsToAnthropicAdmin(body.upstreamKeyId, agent.orgId))
      ) {
        reply.code(400);
        return { error: "invalid_upstream_key" };
      }

      const now = new Date();
      // Upsert on the agent's 1:1 link — a second PUT edits the existing row
      // rather than accumulating duplicates for the same agent.
      await db
        .insert(anthropicManagedAgentLinks)
        .values({
          id: randomUUID(),
          agentId: agent.id,
          orgId: agent.orgId,
          anthropicApiKeyId: body.anthropicApiKeyId,
          anthropicWorkspaceId: body.anthropicWorkspaceId,
          currentSessionId: body.currentSessionId,
          upstreamKeyId: body.upstreamKeyId,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: anthropicManagedAgentLinks.agentId,
          set: {
            anthropicApiKeyId: body.anthropicApiKeyId,
            anthropicWorkspaceId: body.anthropicWorkspaceId,
            currentSessionId: body.currentSessionId,
            upstreamKeyId: body.upstreamKeyId,
            updatedAt: now,
          },
        });

      return {
        link: {
          anthropicApiKeyId: body.anthropicApiKeyId,
          anthropicWorkspaceId: body.anthropicWorkspaceId,
          currentSessionId: body.currentSessionId,
          upstreamKeyId: body.upstreamKeyId,
        },
      };
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/v1/agents/:id/anthropic-link",
    async (req, reply) => {
      const orgId = req.activeOrgId!;
      const agent = await findAgentForLink(req.params.id, orgId, req.authUser!.id);
      if (agent === null) {
        reply.code(404);
        return { error: "agent_not_found" };
      }
      if (
        !(await canPerformDashboardAction(
          agent.dashboardId,
          agent.dashboardOrgId,
          orgId,
          req.authUser!.id,
          "updateAgent",
        ))
      ) {
        reply.code(403);
        return {
          error: "dashboard_permission_denied",
          message: "Your role doesn't allow editing agents on this dashboard.",
        };
      }

      await db.delete(anthropicManagedAgentLinks).where(eq(anthropicManagedAgentLinks.agentId, agent.id));
      return { deleted: true };
    },
  );
}

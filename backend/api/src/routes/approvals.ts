import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { and, desc, eq } from "drizzle-orm";
import type { Redis } from "ioredis";
import { ASSISTANT_ADAPTER_SLUGS, toolGrantKey, type SpendDecision } from "@tollgate/shared";
import { db } from "../db/client.js";
import { agents, spendEvents, toolApprovalRequests } from "../db/schema.js";

/**
 * The operator half of the tool gate's escalation path. The proxy raises
 * pending requests (backend/proxy/src/lib/tool-approvals.ts) and never
 * resolves one; these routes resolve them and never raise one. That split is
 * what keeps an agent from approving itself.
 *
 * Approving deliberately does NOT edit policies.blocked_tools. It arms a
 * single-use Redis grant the proxy spends with an atomic DEL on the agent's
 * next attempt, so "yes, this once" stays exactly that — the blocklist
 * remains the standing policy.
 */

/**
 * How long an armed grant stays spendable. Long enough for an agent on a
 * retry/backoff loop to come back around, short enough that an approval
 * nobody's agent ever acted on doesn't sit armed indefinitely. The grant is
 * single-use regardless — this is only the backstop for one never spent.
 */
const GRANT_TTL_SECONDS = 15 * 60;

/** Pending requests are the queue; resolved ones are history. Capped so a
 *  runaway agent can't make this response unbounded. */
const PENDING_LIMIT = 200;

/**
 * Records the operator's decision in the same audit log the proxy writes its
 * own verdicts to, so the activity feed reads as one story: the agent was
 * blocked, then a named person let it through (or didn't).
 *
 * Follows the house rule that a decision is never silent — the same reason
 * recordDenial exists in the proxy. Awaited rather than fire-and-forget
 * (unlike the hot path, which can't afford the round trip): this is an
 * operator clicking a button, and an approval whose audit row silently failed
 * to write is worse than a slightly slower click.
 */
async function recordDecision(args: {
  agentId: string;
  assistantSlug: string;
  toolName: string;
  decision: Extract<SpendDecision, "approval_granted" | "approval_denied">;
}): Promise<void> {
  await db.insert(spendEvents).values({
    id: randomUUID(),
    agentId: args.agentId,
    // spend_events.provider_id holds the ADAPTER slug in the proxy's own
    // writes; map the agent's assistant label the same way the proxy's gate
    // does so both writers speak one vocabulary in this column.
    providerId: ASSISTANT_ADAPTER_SLUGS[args.assistantSlug] ?? args.assistantSlug,
    // Not a real upstream path — this row is an operator action, and naming
    // the tool here is what makes the log entry legible without a join.
    endpoint: `/approvals/${args.toolName}`,
    method: "POST",
    estimatedCostCents: null,
    // A decision costs nothing; the agent's retry is what spends money.
    actualCostCents: "0",
    decision: args.decision,
    model: null,
    promptTokens: null,
    completionTokens: null,
    idempotencyKey: randomUUID(),
    latencyMs: null,
    upstreamStatus: null,
    prompt: null,
  });
}

export function registerApprovalRoutes(app: FastifyInstance, redis: Redis): void {
  /**
   * The operator's queue. Scoped by joining through agents on the caller's
   * active org — tool_approval_requests carries its own org_id (stamped by the
   * proxy from the authenticated agent), but the join is what makes this
   * consistent with every other org-scoped read in the api, and it's also
   * where the agent's display name comes from.
   */
  app.get("/v1/approvals", async (req) => {
    const orgId = req.activeOrgId!;

    const rows = await db
      .select({
        id: toolApprovalRequests.id,
        agentId: toolApprovalRequests.agentId,
        agentName: agents.name,
        toolName: toolApprovalRequests.toolName,
        status: toolApprovalRequests.status,
        createdAt: toolApprovalRequests.createdAt,
      })
      .from(toolApprovalRequests)
      .innerJoin(agents, eq(agents.id, toolApprovalRequests.agentId))
      .where(
        and(eq(agents.orgId, orgId), eq(toolApprovalRequests.status, "pending")),
      )
      .orderBy(desc(toolApprovalRequests.createdAt))
      .limit(PENDING_LIMIT);

    return rows.map((row) => ({
      id: row.id,
      agentId: row.agentId,
      agentName: row.agentName,
      toolName: row.toolName,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
    }));
  });

  app.post<{ Params: { id: string } }>(
    "/v1/approvals/:id/approve",
    async (req, reply) => {
      const request = await findPendingRequest(req.params.id, req.activeOrgId!);
      if (request === null) {
        reply.code(404);
        return { error: "approval_request_not_found" };
      }

      // Grant BEFORE marking resolved: if the write below fails, the operator
      // sees a request still sitting in their queue rather than one marked
      // approved whose agent was never actually let through. The reverse order
      // would lose the approval silently.
      await redis.set(
        toolGrantKey(request.agentId, request.toolName),
        "1",
        "EX",
        GRANT_TTL_SECONDS,
      );

      await db
        .update(toolApprovalRequests)
        .set({
          status: "approved",
          resolvedAt: new Date(),
          resolvedBy: req.authUser!.id,
        })
        .where(eq(toolApprovalRequests.id, request.id));

      await recordDecision({
        agentId: request.agentId,
        assistantSlug: request.assistantSlug,
        toolName: request.toolName,
        decision: "approval_granted",
      });

      return { id: request.id, status: "approved" as const };
    },
  );

  app.post<{ Params: { id: string } }>("/v1/approvals/:id/deny", async (req, reply) => {
    const request = await findPendingRequest(req.params.id, req.activeOrgId!);
    if (request === null) {
      reply.code(404);
      return { error: "approval_request_not_found" };
    }

    // No Redis write at all: denying is the default state of the world (the
    // blocklist already denies), so this only closes the queue entry. A denied
    // request doesn't suppress a later one — the partial unique index is on
    // pending rows only, so the agent trying again re-raises it.
    await db
      .update(toolApprovalRequests)
      .set({
        status: "denied",
        resolvedAt: new Date(),
        resolvedBy: req.authUser!.id,
      })
      .where(eq(toolApprovalRequests.id, request.id));

    await recordDecision({
      agentId: request.agentId,
      assistantSlug: request.assistantSlug,
      toolName: request.toolName,
      decision: "approval_denied",
    });

    return { id: request.id, status: "denied" as const };
  });
}

/**
 * Org-scoped lookup restricted to PENDING rows, so resolving an already
 * resolved request 404s rather than silently re-arming a grant for one an
 * operator (or their colleague, on the next poll) already handled.
 */
async function findPendingRequest(
  id: string,
  orgId: string,
): Promise<{ id: string; agentId: string; toolName: string; assistantSlug: string } | null> {
  const rows = await db
    .select({
      id: toolApprovalRequests.id,
      agentId: toolApprovalRequests.agentId,
      toolName: toolApprovalRequests.toolName,
      assistantSlug: agents.providerSlug,
    })
    .from(toolApprovalRequests)
    .innerJoin(agents, eq(agents.id, toolApprovalRequests.agentId))
    .where(
      and(
        eq(toolApprovalRequests.id, id),
        eq(agents.orgId, orgId),
        eq(toolApprovalRequests.status, "pending"),
      ),
    );

  return rows[0] ?? null;
}

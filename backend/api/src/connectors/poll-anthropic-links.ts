/**
 * The reusable core of external agent governance's Phase 2 + Phase 4 polling
 * (see the approved plan at .claude/plans/dapper-greeting-flame.md): for
 * every agent linked to an Anthropic Managed Agents session, pulls real usage
 * since the last poll, turns it into the same real spend_events rows a
 * proxied agent's traffic would produce, and syncs the linked session's own
 * native budget cap (Phase 4) to the agent's current policy.
 *
 * Two callers share this: index.ts's own in-process interval (so a fresh
 * install "just works" with no separate setup step — see its own doc comment
 * for why an in-process scheduler is the right call here specifically) and
 * db/poll-anthropic-usage.ts, a thin CLI wrapper kept for operators who'd
 * rather run this on their own external cron instead.
 *
 * One link's failure (a revoked key, a session that no longer exists) is
 * logged and skipped rather than aborting the whole run — every other org's
 * poll should not depend on this one link being healthy.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { centsToMicroCents, currentMonth, spendKey, tokenKey } from "@tollgate/shared";
import { redis } from "../lib/redis.js";
import { anthropicManagedAgentsConnector } from "./anthropic-managed-agents.js";
import { db } from "../db/client.js";
import { agents, anthropicManagedAgentLinks, policies, spendEvents } from "../db/schema.js";

type Link = typeof anthropicManagedAgentLinks.$inferSelect;

// First-ever poll for a link (lastPolledAt is null) looks back this far
// rather than to the link's own createdAt, which could be days old — bounded
// to what a single usage-report call can actually return in full (see
// anthropic-managed-agents.ts's MAX_1M_BUCKETS_PER_CALL) so the first poll
// doesn't silently under-report a wide, truncated window.
const FIRST_POLL_LOOKBACK_MS = 24 * 60 * 60 * 1000;

async function recordUsage(link: Link, now: Date): Promise<{ buckets: number; costCents: number }> {
  const since = link.lastPolledAt ?? new Date(now.getTime() - FIRST_POLL_LOOKBACK_MS);
  const buckets = await anthropicManagedAgentsConnector.pollUsage({ link, since, now });

  let totalCostCents = 0;
  let totalTokens = 0;

  for (const bucket of buckets) {
    if (bucket.costCents !== null) totalCostCents += bucket.costCents;
    totalTokens += bucket.promptTokens + bucket.completionTokens;

    await db.insert(spendEvents).values({
      id: randomUUID(),
      agentId: link.agentId,
      // The real underlying provider is Claude regardless of the fact that
      // Tollgate never proxied this traffic — matches the adapter slug
      // vocabulary every other spend_events row uses, so the activity log's
      // existing per-provider rendering needs no special case for this row.
      providerId: "claude",
      endpoint: "/anthropic-managed-agents",
      method: "usage-report",
      estimatedCostCents: null,
      actualCostCents: bucket.costCents === null ? null : String(bucket.costCents),
      decision: "allowed",
      model: bucket.model,
      promptTokens: bucket.promptTokens,
      completionTokens: bucket.completionTokens,
      idempotencyKey: randomUUID(),
      latencyMs: null,
      upstreamStatus: null,
      // No request text exists for usage pulled after the fact — nothing to
      // show the activity log's drill-in, unlike a proxied request's prompt.
      prompt: null,
    });
  }

  // Redis is the dashboard's live "this month's spend" counter (see
  // agents.ts's GET /v1/agents) — spend_events rows above feed the activity
  // log, but the headline figure reads Redis specifically, so both need
  // updating for a linked agent's real dollars to actually show up there.
  if (totalCostCents > 0 || totalTokens > 0) {
    const month = currentMonth(now);
    if (totalCostCents > 0) {
      await redis.incrby(spendKey(link.agentId, month), centsToMicroCents(totalCostCents));
    }
    if (totalTokens > 0) {
      await redis.incrby(tokenKey(link.agentId, month), totalTokens);
    }
  }

  await db
    .update(anthropicManagedAgentLinks)
    .set({ lastPolledAt: now, updatedAt: now })
    .where(eq(anthropicManagedAgentLinks.id, link.id));

  return { buckets: buckets.length, costCents: totalCostCents };
}

/**
 * Phase 4: keeps the linked session's native budget cap in step with the
 * agent's own policy, every poll — a declarative sync (not "did the policy
 * change since last time"), so Anthropic's own runtime is always enforcing
 * whatever Tollgate's dashboard currently says the cap is. Skipped entirely
 * (not "removed") when the policy has no numeric cap — see
 * anthropicManagedAgentsConnector.setBudget's doc comment for why an
 * automated sync must never trigger Anthropic's one-way budget removal.
 */
async function syncBudget(link: Link): Promise<void> {
  if (link.currentSessionId === null || anthropicManagedAgentsConnector.setBudget === undefined) return;

  const [agentRow] = await db.select({ policyId: agents.policyId }).from(agents).where(eq(agents.id, link.agentId));
  if (agentRow?.policyId == null) return;

  const [policyRow] = await db
    .select({ maxBudgetCents: policies.maxBudgetCents })
    .from(policies)
    .where(eq(policies.id, agentRow.policyId));
  if (policyRow?.maxBudgetCents == null || policyRow.maxBudgetCents <= 0) return;

  const result = await anthropicManagedAgentsConnector.setBudget({
    link,
    maxCostCents: policyRow.maxBudgetCents,
  });
  if (!result.ok) {
    console.warn(`[anthropic-poll] setBudget failed for agent ${link.agentId}: ${result.reason}`);
  }
}

export async function pollAllAnthropicLinks(): Promise<{ linksPolled: number; linksFailed: number }> {
  const now = new Date();
  const links = await db.select().from(anthropicManagedAgentLinks);

  let linksFailed = 0;
  for (const link of links) {
    try {
      const { buckets, costCents } = await recordUsage(link, now);
      console.log(`[anthropic-poll] agent ${link.agentId}: ${buckets} bucket(s), $${(costCents / 100).toFixed(4)}`);
      await syncBudget(link);
    } catch (err) {
      linksFailed += 1;
      console.error(`[anthropic-poll] failed for link ${link.id} (agent ${link.agentId})`, err);
    }
  }

  return { linksPolled: links.length, linksFailed };
}

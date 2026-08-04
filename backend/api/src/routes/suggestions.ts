import type { FastifyInstance } from "fastify";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import {
  AZURE_PRICES,
  BEDROCK_PRICES,
  CLAUDE_PRICES,
  GEMINI_PRICES,
  OPENAI_PRICES,
  findModelPrice,
  type ModelPrice,
} from "@tollgate/shared";
import { db } from "../db/client.js";
import { agents, spendEvents } from "../db/schema.js";
import { detectRepeatedBlock, estimateTokens, estimateWasteCents } from "../lib/prompt-waste.js";

/**
 * Token-waste findings, per agent: the static block an agent re-sends on every
 * request, and roughly what it costs.
 *
 * READ-ONLY AND ADVISORY. Nothing here rewrites a prompt or changes a policy.
 * Tollgate silently trimming an agent's request could change its behaviour in
 * ways the customer can't debug, and this product's credibility rests on being
 * predictable — so the finding goes to a human who decides.
 *
 * Runs on demand rather than on a schedule. It's a handful of string
 * comparisons over a bounded sample, the dashboard asks for it when someone is
 * looking, and a cron job would mean storing findings that go stale the moment
 * the customer edits their app.
 */

/** Requests sampled per agent. Enough for the frequency figure to mean
 *  something, small enough that the scan stays well under a page load. */
const SAMPLE_SIZE = 100;

/** Adapter slug -> that provider's price table, mirroring how each adapter
 *  picks its own in backend/proxy/src/adapters. Kept here rather than imported
 *  from the proxy because the api must not depend on the hot path's package. */
const PRICES_BY_PROVIDER: Record<string, Record<string, ModelPrice>> = {
  openai: OPENAI_PRICES,
  azure: AZURE_PRICES,
  claude: CLAUDE_PRICES,
  gemini: GEMINI_PRICES,
  bedrock: BEDROCK_PRICES,
};

function inputPriceFor(providerId: string, model: string | null): number | null {
  if (model === null) return null;
  const table = PRICES_BY_PROVIDER[providerId];
  if (table === undefined) return null;
  return findModelPrice(model, table)?.inputCentsPerMTok ?? null;
}

export interface PromptSuggestion {
  agentId: string;
  agentName: string;
  /** The repeated text itself, truncated for display — the operator needs to
   *  recognise it, not read all of it. */
  sample: string;
  repeatedTokens: number;
  /** 0..1 share of sampled requests carrying the block. */
  frequency: number;
  position: "prefix" | "suffix";
  sampledRequests: number;
  /** Estimated cost of the block across the sampled requests. Null when the
   *  model has no known price — see estimateWasteCents on why that's reported
   *  as unknown rather than zero. */
  wasteCents: number | null;
}

/** How much of the block to hand the dashboard. Long enough to recognise,
 *  short enough not to ship a whole catalog into a JSON response. */
const SAMPLE_CHARS = 400;

export function registerSuggestionRoutes(app: FastifyInstance): void {
  app.get("/v1/suggestions", async (req) => {
    const orgId = req.activeOrgId!;

    const orgAgents = await db
      .select({ id: agents.id, name: agents.name })
      .from(agents)
      .where(and(eq(agents.orgId, orgId), eq(agents.status, "active")));

    const suggestions: PromptSuggestion[] = [];

    for (const agent of orgAgents) {
      // Only rows that actually carry a prompt: pre-forward denials and the
      // operator-decision rows have none, and counting them would deflate the
      // frequency figure with requests that were never sent.
      const rows = await db
        .select({
          prompt: spendEvents.prompt,
          model: spendEvents.model,
          providerId: spendEvents.providerId,
        })
        .from(spendEvents)
        .where(and(eq(spendEvents.agentId, agent.id), isNotNull(spendEvents.prompt)))
        .orderBy(desc(spendEvents.createdAt))
        .limit(SAMPLE_SIZE);

      if (rows.length < 2) continue;

      const block = detectRepeatedBlock(rows.map((r) => r.prompt ?? ""));
      if (block === null) continue;

      // Price off the most recent priced row: an agent that switched models
      // mid-sample should be costed at what it's paying NOW, not an average of
      // what it used to.
      const priced = rows.find((r) => inputPriceFor(r.providerId, r.model) !== null);
      const inputPrice =
        priced === undefined ? null : inputPriceFor(priced.providerId, priced.model);

      suggestions.push({
        agentId: agent.id,
        agentName: agent.name,
        sample: block.text.slice(0, SAMPLE_CHARS),
        repeatedTokens: estimateTokens(block.text),
        frequency: block.frequency,
        position: block.position,
        sampledRequests: rows.length,
        wasteCents: estimateWasteCents(block, rows.length, inputPrice),
      });
    }

    // Costliest first — an operator with one minute should spend it on the
    // agent burning the most. Unpriced findings sort last rather than first:
    // "unknown" isn't "worst".
    suggestions.sort((a, b) => (b.wasteCents ?? -1) - (a.wasteCents ?? -1));
    return suggestions;
  });
}

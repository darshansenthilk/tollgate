import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Vault } from "../lib/vault.js";

/**
 * Internal-only routes that decrypt an org's platform-connector credential
 * (an Anthropic Admin key, later a Salesforce connected app) and make the
 * real outbound call server-side, on api's behalf.
 *
 * WHY THIS EXISTS: backend/api can only ENCRYPT upstream credentials,
 * backend/proxy can only DECRYPT them (see lib/upstream-key-crypto.ts's doc
 * comment — "neither can accidentally perform the other's operation"). The
 * usage pollers (external agent governance) need to decrypt an Anthropic
 * Admin key from api's side. Rather than break that boundary by giving api
 * its own decrypt function, api calls THIS route instead — proxy decrypts
 * and calls the real provider, and only ever returns the provider's
 * response, never the plaintext secret itself. api never sees the secret,
 * even transiently.
 *
 * NOT INTERNET-FACING. Gated by a shared secret (INTERNAL_CONNECTOR_SECRET),
 * checked with a timing-safe comparison since it's a bare-secret auth check
 * rather than a hashed-token lookup — the class of check where timing leaks
 * matter most. In production this route should additionally never be
 * reachable from outside the deployment's own private network; the shared
 * secret is defense in depth, not the only control.
 *
 * DELIBERATELY NARROW, not a generic "make any request with any credential"
 * proxy: each route below names one specific real provider endpoint. A
 * generic version would be a confused-deputy / SSRF surface (api telling
 * proxy to fetch an arbitrary attacker-chosen URL with a decrypted secret
 * attached) — see CLAUDE.md's "no speculative abstractions" for why this
 * isn't generalized ahead of a second connector actually needing it.
 */

const ANTHROPIC_USAGE_URL = "https://api.anthropic.com/v1/organizations/usage_report/messages";
const ANTHROPIC_SESSIONS_URL = "https://api.anthropic.com/v1/sessions";
const ANTHROPIC_VERSION = "2023-06-01";
// Required on every Managed Agents API call (sessions, budgets) — confirmed
// against the real docs, not assumed. The usage-report endpoint above is a
// separate, non-beta Admin API and takes no such header.
const MANAGED_AGENTS_BETA = "managed-agents-2026-04-01";

export interface InternalConnectorDeps {
  vault: Vault;
  fetchImpl: typeof fetch;
}

interface AnthropicUsageBody {
  orgId: string;
  upstreamKeyId: string;
  startingAt: string;
  endingAt: string;
  apiKeyIds: string[];
  bucketWidth?: "1m" | "1h" | "1d";
  /** Anthropic's own default is 60 buckets for bucket_width=1m — without an
   *  explicit limit, a poll window over an hour silently truncates. */
  limit?: number;
  /** Anthropic's next_page token, for continuing a paginated report. */
  page?: string;
}

function isAnthropicUsageBody(body: unknown): body is AnthropicUsageBody {
  if (typeof body !== "object" || body === null) return false;
  const b = body as Record<string, unknown>;
  if (b["limit"] !== undefined && typeof b["limit"] !== "number") return false;
  if (b["page"] !== undefined && typeof b["page"] !== "string") return false;
  return (
    typeof b["orgId"] === "string" &&
    typeof b["upstreamKeyId"] === "string" &&
    typeof b["startingAt"] === "string" &&
    typeof b["endingAt"] === "string" &&
    Array.isArray(b["apiKeyIds"]) &&
    b["apiKeyIds"].every((id) => typeof id === "string")
  );
}

interface AnthropicSessionBudgetBody {
  orgId: string;
  upstreamKeyId: string;
  sessionId: string;
  /** Whole positive cents — matches Anthropic's own `max_list_cost.amount`
   *  format (a string of whole cents, no decimals). Deliberately no way to
   *  express "remove the budget" here: removing a Managed Agents session
   *  budget is one-way (a session whose budget is removed can never be given
   *  one again, confirmed against the real docs) — an automated poller
   *  should never be able to take that action, so the request shape itself
   *  doesn't allow it. See anthropicManagedAgentsConnector.setBudget's doc
   *  comment in backend/api/src/connectors/ for the full reasoning. */
  maxCostCents: number;
}

function isAnthropicSessionBudgetBody(body: unknown): body is AnthropicSessionBudgetBody {
  if (typeof body !== "object" || body === null) return false;
  const b = body as Record<string, unknown>;
  return (
    typeof b["orgId"] === "string" &&
    typeof b["upstreamKeyId"] === "string" &&
    typeof b["sessionId"] === "string" &&
    typeof b["maxCostCents"] === "number" &&
    Number.isInteger(b["maxCostCents"]) &&
    b["maxCostCents"] > 0
  );
}

/** Constant-time secret check — a plain `===` here would let an attacker
 *  learn the secret one byte at a time from response-time differences,
 *  exactly the class of bug timingSafeEqual exists to close. Length is
 *  checked first since timingSafeEqual itself throws on mismatched lengths
 *  rather than returning false. */
function isAuthorized(req: { headers: Record<string, string | string[] | undefined> }): boolean {
  const expected = process.env.INTERNAL_CONNECTOR_SECRET;
  if (expected === undefined || expected === "") return false;
  const provided = req.headers["x-internal-secret"];
  if (typeof provided !== "string") return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function registerInternalConnectorRoutes(
  app: FastifyInstance,
  deps: InternalConnectorDeps,
): void {
  app.post("/internal/connectors/anthropic-usage", async (req, reply) => {
    if (!isAuthorized(req)) {
      reply.code(401);
      return { error: "unauthorized" };
    }

    if (!isAnthropicUsageBody(req.body)) {
      reply.code(400);
      return { error: "invalid_body" };
    }
    const { orgId, upstreamKeyId, startingAt, endingAt, apiKeyIds, bucketWidth, limit, page } = req.body;

    // "anthropic-admin" is the credential provider slug from
    // backend/shared's UPSTREAM_PROVIDERS — pgVault works unchanged for it,
    // same generic (orgId, slug, keyId) -> decrypted credential lookup every
    // other provider already uses.
    const credential = await deps.vault.getUpstreamKey(orgId, "anthropic-admin", upstreamKeyId);
    if (credential === null) {
      reply.code(502);
      return { error: "credential_unavailable" };
    }
    const adminApiKey = credential.secrets["adminApiKey"];
    if (adminApiKey === undefined || adminApiKey === "") {
      reply.code(502);
      return { error: "credential_incomplete" };
    }

    const url = new URL(ANTHROPIC_USAGE_URL);
    url.searchParams.set("starting_at", startingAt);
    url.searchParams.set("ending_at", endingAt);
    url.searchParams.set("bucket_width", bucketWidth ?? "1m");
    for (const id of apiKeyIds) url.searchParams.append("api_key_ids[]", id);
    // Without group_by, Anthropic's own docs say `model` and `api_key_id`
    // come back null on every result — the poller can't price usage it can't
    // attribute to a model. Confirmed against the real API reference, not
    // assumed (an earlier version of this route omitted this and would have
    // silently priced everything as "unknown model").
    url.searchParams.append("group_by[]", "model");
    url.searchParams.append("group_by[]", "api_key_id");
    if (limit !== undefined) url.searchParams.set("limit", String(limit));
    if (page !== undefined) url.searchParams.set("page", page);

    const upstream = await deps.fetchImpl(url, {
      headers: {
        "anthropic-version": ANTHROPIC_VERSION,
        "x-api-key": adminApiKey,
      },
    });

    // Passed through verbatim, success or failure — the poller (api side)
    // decides how to interpret a 4xx/5xx from Anthropic; this route's job is
    // only "decrypt and call", not "understand the response".
    reply.code(upstream.status);
    return upstream.json();
  });

  // Native budget delegation (Phase 4): sets a Managed Agents session's
  // dollar cap so Anthropic's own runtime pauses the session when it's
  // reached, layered on top of the usage-polling loop above rather than a
  // separate trigger. Anthropic only accepts an UPDATE here, never an
  // initial create — a budget can only be attached when a session is first
  // created (by whatever created it, not Tollgate), so this route always
  // targets an existing, already-known sessionId.
  app.post("/internal/connectors/anthropic-session-budget", async (req, reply) => {
    if (!isAuthorized(req)) {
      reply.code(401);
      return { error: "unauthorized" };
    }

    if (!isAnthropicSessionBudgetBody(req.body)) {
      reply.code(400);
      return { error: "invalid_body" };
    }
    const { orgId, upstreamKeyId, sessionId, maxCostCents } = req.body;

    const credential = await deps.vault.getUpstreamKey(orgId, "anthropic-admin", upstreamKeyId);
    if (credential === null) {
      reply.code(502);
      return { error: "credential_unavailable" };
    }
    const adminApiKey = credential.secrets["adminApiKey"];
    if (adminApiKey === undefined || adminApiKey === "") {
      reply.code(502);
      return { error: "credential_incomplete" };
    }

    const upstream = await deps.fetchImpl(`${ANTHROPIC_SESSIONS_URL}/${sessionId}`, {
      method: "POST",
      headers: {
        "anthropic-version": ANTHROPIC_VERSION,
        "anthropic-beta": MANAGED_AGENTS_BETA,
        "x-api-key": adminApiKey,
        "content-type": "application/json",
      },
      // amount is a STRING of whole cents, no decimals, no leading zeros —
      // Anthropic rejects "25.00" and rejects a JSON number here (the field
      // is typed as a string specifically so no float rounding ever touches
      // it). Confirmed against the real docs, not assumed.
      body: JSON.stringify({
        budget: { type: "limit", max_list_cost: { amount: String(maxCostCents), currency: "USD" } },
      }),
    });

    // Same passthrough philosophy as the usage route above — including the
    // real 400s Anthropic returns for "new cap isn't above consumed spend"
    // and "this session has no budget to update", both of which the poller
    // (api side) needs to see and handle as expected outcomes, not failures
    // to log-and-ignore.
    reply.code(upstream.status);
    return upstream.json();
  });
}

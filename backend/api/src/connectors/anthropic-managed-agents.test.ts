import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createAnthropicManagedAgentsConnector } from "./anthropic-managed-agents.js";
import type { AnthropicManagedAgentLink } from "./types.js";

const ORIGINAL_SECRET = process.env.INTERNAL_CONNECTOR_SECRET;
const ORIGINAL_PROXY_URL = process.env.PROXY_INTERNAL_URL;

beforeEach(() => {
  process.env.INTERNAL_CONNECTOR_SECRET = "test-secret";
  process.env.PROXY_INTERNAL_URL = "http://proxy.internal";
});

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.INTERNAL_CONNECTOR_SECRET;
  else process.env.INTERNAL_CONNECTOR_SECRET = ORIGINAL_SECRET;
  if (ORIGINAL_PROXY_URL === undefined) delete process.env.PROXY_INTERNAL_URL;
  else process.env.PROXY_INTERNAL_URL = ORIGINAL_PROXY_URL;
});

/** Records every call and returns whatever the test queues, matching
 *  backend/proxy/test/helpers.ts's MockUpstream pattern for the same reason:
 *  proves the connector never really left the process. */
function fakeFetch(responder: (url: string, init: Parameters<typeof fetch>[1]) => Response) {
  const calls: { url: string; init: Parameters<typeof fetch>[1] }[] = [];
  const fn = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = String(input);
    calls.push({ url, init });
    return responder(url, init);
  }) as typeof fetch;
  return { fn, calls };
}

function link(overrides: Partial<AnthropicManagedAgentLink> = {}): AnthropicManagedAgentLink {
  return {
    id: "link-1",
    agentId: "agent-1",
    orgId: "org-1",
    upstreamKeyId: "key-1",
    anthropicApiKeyId: "apikey_abc",
    anthropicWorkspaceId: null,
    currentSessionId: null,
    lastPolledAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

test("pollUsage throws when the link has no upstreamKeyId, without making a network call", async () => {
  const { fn, calls } = fakeFetch(() => new Response("{}", { status: 200 }));
  const connector = createAnthropicManagedAgentsConnector(fn);

  await assert.rejects(() =>
    connector.pollUsage({
      link: link({ upstreamKeyId: null }),
      since: new Date("2026-01-01T00:00:00Z"),
      now: new Date("2026-01-01T01:00:00Z"),
    }),
  );
  assert.equal(calls.length, 0);
});

test("pollUsage prices results via CLAUDE_PRICES and skips buckets with no model", async () => {
  const { fn, calls } = fakeFetch(
    () =>
      new Response(
        JSON.stringify({
          data: [
            {
              starting_at: "2026-01-01T00:00:00Z",
              ending_at: "2026-01-01T00:01:00Z",
              results: [
                { model: "claude-3-5-sonnet-20241022", uncached_input_tokens: 1_000_000, output_tokens: 1_000_000 },
                { model: null, uncached_input_tokens: 500 }, // ungrouped/unattributed — must be skipped
              ],
            },
          ],
          has_more: false,
        }),
        { status: 200 },
      ),
  );
  const connector = createAnthropicManagedAgentsConnector(fn);

  const buckets = await connector.pollUsage({
    link: link(),
    since: new Date("2026-01-01T00:00:00Z"),
    now: new Date("2026-01-01T00:05:00Z"),
  });

  assert.equal(buckets.length, 1);
  // claude-3-5-sonnet: 300 cents/MTok in, 1500 cents/MTok out — 1M tokens
  // each means the raw per-MTok rate is the answer directly.
  assert.equal(buckets[0]?.costCents, 300 + 1500);
  assert.equal(buckets[0]?.promptTokens, 1_000_000);
  assert.equal(buckets[0]?.completionTokens, 1_000_000);
  assert.equal(buckets[0]?.model, "claude-3-5-sonnet-20241022");

  const call = calls[0];
  assert.equal(call?.url, "http://proxy.internal/internal/connectors/anthropic-usage");
  const headers = call?.init?.headers as Record<string, string>;
  assert.equal(headers["x-internal-secret"], "test-secret");
  const body = JSON.parse(call?.init?.body as string);
  assert.deepEqual(body.apiKeyIds, ["apikey_abc"]);
  assert.equal(body.upstreamKeyId, "key-1");
});

test("pollUsage reports costCents: null for a model with no known price, but still reports tokens", async () => {
  const { fn } = fakeFetch(
    () =>
      new Response(
        JSON.stringify({
          data: [
            {
              starting_at: "2026-01-01T00:00:00Z",
              ending_at: "2026-01-01T00:01:00Z",
              results: [{ model: "claude-opus-9000", uncached_input_tokens: 100, output_tokens: 50 }],
            },
          ],
          has_more: false,
        }),
        { status: 200 },
      ),
  );
  const connector = createAnthropicManagedAgentsConnector(fn);

  const buckets = await connector.pollUsage({
    link: link(),
    since: new Date("2026-01-01T00:00:00Z"),
    now: new Date("2026-01-01T00:01:00Z"),
  });

  assert.equal(buckets.length, 1);
  assert.equal(buckets[0]?.costCents, null);
  assert.equal(buckets[0]?.promptTokens, 100);
});

test("pollUsage follows pagination via next_page until has_more is false", async () => {
  let call = 0;
  const { fn, calls } = fakeFetch(() => {
    call += 1;
    if (call === 1) {
      return new Response(
        JSON.stringify({
          data: [{ starting_at: "a", ending_at: "b", results: [{ model: "claude-3-5-haiku", uncached_input_tokens: 10, output_tokens: 5 }] }],
          has_more: true,
          next_page: "page_2",
        }),
        { status: 200 },
      );
    }
    return new Response(
      JSON.stringify({
        data: [{ starting_at: "c", ending_at: "d", results: [{ model: "claude-3-5-haiku", uncached_input_tokens: 20, output_tokens: 10 }] }],
        has_more: false,
      }),
      { status: 200 },
    );
  });
  const connector = createAnthropicManagedAgentsConnector(fn);

  const buckets = await connector.pollUsage({
    link: link(),
    since: new Date("2026-01-01T00:00:00Z"),
    now: new Date("2026-01-01T00:02:00Z"),
  });

  assert.equal(buckets.length, 2);
  assert.equal(calls.length, 2);
  const secondBody = JSON.parse(calls[1]?.init?.body as string);
  assert.equal(secondBody.page, "page_2");
});

test("pollUsage throws with the upstream body when proxy's internal route returns non-200", async () => {
  const { fn } = fakeFetch(() => new Response(JSON.stringify({ error: "credential_unavailable" }), { status: 502 }));
  const connector = createAnthropicManagedAgentsConnector(fn);

  await assert.rejects(
    () =>
      connector.pollUsage({
        link: link(),
        since: new Date("2026-01-01T00:00:00Z"),
        now: new Date("2026-01-01T00:01:00Z"),
      }),
    /502/,
  );
});

test("setBudget refuses without a currentSessionId, without making a network call", async () => {
  const { fn, calls } = fakeFetch(() => new Response("{}", { status: 200 }));
  const connector = createAnthropicManagedAgentsConnector(fn);

  const result = await connector.setBudget!({ link: link({ currentSessionId: null }), maxCostCents: 2500 });

  assert.equal(result.ok, false);
  assert.equal(calls.length, 0);
});

test("setBudget sends the session budget update and reports ok on 200", async () => {
  const { fn, calls } = fakeFetch(() => new Response(JSON.stringify({ id: "sess_1" }), { status: 200 }));
  const connector = createAnthropicManagedAgentsConnector(fn);

  const result = await connector.setBudget!({
    link: link({ currentSessionId: "sess_1" }),
    maxCostCents: 2500,
  });

  assert.equal(result.ok, true);
  const call = calls[0];
  assert.equal(call?.url, "http://proxy.internal/internal/connectors/anthropic-session-budget");
  const body = JSON.parse(call?.init?.body as string);
  assert.equal(body.sessionId, "sess_1");
  assert.equal(body.maxCostCents, 2500);
});

test("setBudget surfaces Anthropic's real error message on a real rejection (e.g. cap below consumed spend)", async () => {
  const { fn } = fakeFetch(
    () =>
      new Response(
        JSON.stringify({ error: { message: "budget.max_list_cost must be greater than the session's consumed list cost" } }),
        { status: 400 },
      ),
  );
  const connector = createAnthropicManagedAgentsConnector(fn);

  const result = await connector.setBudget!({
    link: link({ currentSessionId: "sess_1" }),
    maxCostCents: 10,
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "budget.max_list_cost must be greater than the session's consumed list cost");
  }
});

test("verifyCredential calls the usage route with no api_key_ids filter and reports ok on 200", async () => {
  const { fn, calls } = fakeFetch(() => new Response(JSON.stringify({ data: [] }), { status: 200 }));
  const connector = createAnthropicManagedAgentsConnector(fn);

  const result = await connector.verifyCredential({ orgId: "org-1", upstreamKeyId: "key-1" });

  assert.equal(result.ok, true);
  const body = JSON.parse(calls[0]?.init?.body as string);
  assert.deepEqual(body.apiKeyIds, []);
});

test("verifyCredential reports the real rejection reason on a bad/revoked key", async () => {
  const { fn } = fakeFetch(
    () => new Response(JSON.stringify({ error: { message: "invalid x-api-key" } }), { status: 401 }),
  );
  const connector = createAnthropicManagedAgentsConnector(fn);

  const result = await connector.verifyCredential({ orgId: "org-1", upstreamKeyId: "key-1" });

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "invalid x-api-key");
});

import { describe, it, expect } from "vitest";
import { claudeAdapter } from "../src/adapters/claude.js";
import { spendKey, currentMonth, MICROCENTS_PER_CENT } from "../src/lib/budget.js";
import { buildHarness, FIXED_NOW } from "./helpers.js";

const AGENT_ID = "agent-1";
const TOKEN = "tollgate-secret-token";
const MONTH = currentMonth(FIXED_NOW);
const KEY = spendKey(AGENT_ID, MONTH);

/** A realistic Anthropic Messages API response body for the mock upstream. */
function message(model: string, inputTokens: number, outputTokens: number) {
  return {
    id: "msg_abc",
    type: "message",
    role: "assistant",
    model,
    content: [{ type: "text", text: "hi" }],
    stop_reason: "end_turn",
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
    },
  };
}

describe("POST /claude/* hot path", () => {
  it("forwards, meters the response, and increments the Redis counter", async () => {
    const h = await buildHarness({ adapters: [claudeAdapter] });
    h.agents.add(TOKEN, {
      id: AGENT_ID,
      status: "active",
      maxBudgetCents: 100, // $1.00 ceiling — plenty
      providerSlug: "claude",
    });

    const body = message("claude-3-5-haiku-20241022", 1000, 500);
    h.upstream.setResponder(
      () =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );

    const res = await h.app.inject({
      method: "POST",
      url: "/claude/v1/messages",
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { model: "claude-3-5-haiku-20241022", messages: [{ role: "user", content: "hi" }] },
    });

    // Upstream response returned unchanged.
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(body);

    // Forwarded to the URL + auth the adapter built — never to a route constant.
    expect(h.upstream.calls).toHaveLength(1);
    const call = h.upstream.calls[0];
    expect(call?.url).toBe("https://api.anthropic.com/v1/messages");
    const headers = call?.init?.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-upstream-test");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    expect(headers.authorization).toBeUndefined();

    // cost = 1000 * 80/1e6 + 500 * 400/1e6 = 0.28 cents → 280,000 micro-cents.
    const expectedMicroCents = Math.round(0.28 * MICROCENTS_PER_CENT);
    expect(h.budget.counters.get(KEY)).toBe(expectedMicroCents);

    // Settled to the audit log off the response path.
    expect(h.spendLog.events).toHaveLength(1);
    expect(h.spendLog.events[0]).toMatchObject({
      agentId: AGENT_ID,
      providerId: "claude",
      actualCostCents: 0.28,
      decision: "allowed",
      upstreamStatus: 200,
    });
  });

  it("accumulates spend across successive requests (atomic INCRBY)", async () => {
    const h = await buildHarness({ adapters: [claudeAdapter] });
    h.agents.add(TOKEN, {
      id: AGENT_ID,
      status: "active",
      maxBudgetCents: 100,
      providerSlug: "claude",
    });
    h.upstream.setResponder(
      () =>
        new Response(JSON.stringify(message("claude-3-5-sonnet-20241022", 100, 100)), {
          status: 200,
        }),
    );

    // cost per call = 100*300/1e6 + 100*1500/1e6 = 0.18 cents → 180,000 µ¢.
    const per = Math.round(0.18 * MICROCENTS_PER_CENT);

    for (let i = 0; i < 3; i++) {
      await h.app.inject({
        method: "POST",
        url: "/claude/v1/messages",
        headers: { authorization: `Bearer ${TOKEN}` },
        payload: { model: "claude-3-5-sonnet-20241022" },
      });
    }

    expect(h.budget.counters.get(KEY)).toBe(per * 3);
  });

  it("returns cost 0 for an unrecognized model instead of crashing metering", async () => {
    const h = await buildHarness({ adapters: [claudeAdapter] });
    h.agents.add(TOKEN, {
      id: AGENT_ID,
      status: "active",
      maxBudgetCents: 100,
      providerSlug: "claude",
    });
    h.upstream.setResponder(
      () => new Response(JSON.stringify(message("claude-future-model", 1000, 1000)), { status: 200 }),
    );

    const res = await h.app.inject({
      method: "POST",
      url: "/claude/v1/messages",
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { model: "claude-future-model" },
    });

    expect(res.statusCode).toBe(200);
    expect(h.budget.counters.get(KEY)).toBe(0);
    expect(h.spendLog.events[0]).toMatchObject({ actualCostCents: 0 });
  });

  it("denies with budget_exceeded when the counter is at/over the ceiling", async () => {
    const h = await buildHarness({ adapters: [claudeAdapter] });
    h.agents.add(TOKEN, {
      id: AGENT_ID,
      status: "active",
      maxBudgetCents: 50,
      providerSlug: "claude",
    });
    // Seed spend equal to the ceiling (50 cents = 50,000,000 micro-cents).
    h.budget.seed(KEY, 50 * MICROCENTS_PER_CENT);

    const res = await h.app.inject({
      method: "POST",
      url: "/claude/v1/messages",
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { model: "claude-3-5-haiku-20241022" },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "budget_exceeded" });
    // Enforcement happens before any upstream call or metering.
    expect(h.upstream.calls).toHaveLength(0);
    expect(h.budget.counters.get(KEY)).toBe(50 * MICROCENTS_PER_CENT);
    // The denial IS audited (it's what the dashboard's activity log surfaces),
    // but at zero cost — nothing was forwarded, so nothing was spent.
    expect(h.spendLog.events).toHaveLength(1);
    expect(h.spendLog.events[0]).toMatchObject({
      agentId: AGENT_ID,
      decision: "denied_budget",
      actualCostCents: 0,
    });
  });

  it("denies frozen agents with agent_frozen and never forwards", async () => {
    const h = await buildHarness({ adapters: [claudeAdapter] });
    h.agents.add(TOKEN, {
      id: AGENT_ID,
      status: "soft_frozen",
      maxBudgetCents: 100,
      providerSlug: "claude",
    });

    const res = await h.app.inject({
      method: "POST",
      url: "/claude/v1/messages",
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { model: "claude-3-5-haiku-20241022" },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "agent_frozen" });
    expect(h.upstream.calls).toHaveLength(0);
  });

  it("denies via the Redis frozen flag even when Postgres status is still active", async () => {
    const h = await buildHarness({ adapters: [claudeAdapter] });
    h.agents.add(TOKEN, {
      id: AGENT_ID,
      status: "active",
      maxBudgetCents: 100,
      providerSlug: "claude",
    });
    h.freeze.freeze(AGENT_ID);

    const res = await h.app.inject({
      method: "POST",
      url: "/claude/v1/messages",
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { model: "claude-3-5-haiku-20241022" },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "agent_frozen" });
    expect(h.upstream.calls).toHaveLength(0);
  });

  it("denies with provider_mismatch when the agent's assistant doesn't map to this adapter", async () => {
    const h = await buildHarness({ adapters: [claudeAdapter] });
    h.agents.add(TOKEN, {
      id: AGENT_ID,
      status: "active",
      maxBudgetCents: 100,
      providerSlug: "chatgpt", // created for ChatGPT, not Claude
    });

    const res = await h.app.inject({
      method: "POST",
      url: "/claude/v1/messages",
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { model: "claude-3-5-haiku-20241022" },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({
      error: "provider_mismatch",
      providerSlug: "claude",
      assistantSlug: "chatgpt",
    });
    expect(h.upstream.calls).toHaveLength(0);
  });

  it("rejects missing/invalid tokens before touching budget or upstream", async () => {
    const h = await buildHarness({ adapters: [claudeAdapter] });

    const missing = await h.app.inject({
      method: "POST",
      url: "/claude/v1/messages",
      payload: {},
    });
    expect(missing.statusCode).toBe(401);
    expect(missing.json()).toEqual({ error: "missing_token" });

    const invalid = await h.app.inject({
      method: "POST",
      url: "/claude/v1/messages",
      headers: { authorization: "Bearer nope" },
      payload: {},
    });
    expect(invalid.statusCode).toBe(401);
    expect(invalid.json()).toEqual({ error: "invalid_token" });

    expect(h.upstream.calls).toHaveLength(0);
  });
});

import { describe, it, expect } from "vitest";
import { openaiAdapter } from "../src/adapters/openai.js";
import { spendKey, currentMonth, MICROCENTS_PER_CENT } from "../src/lib/budget.js";
import { buildHarness, FIXED_NOW } from "./helpers.js";

const AGENT_ID = "agent-1";
const TOKEN = "tollgate-secret-token";
const MONTH = currentMonth(FIXED_NOW);
const KEY = spendKey(AGENT_ID, MONTH);

/** A realistic OpenAI chat-completions response body for the mock upstream. */
function completion(model: string, prompt: number, completion: number) {
  return {
    id: "chatcmpl-abc",
    object: "chat.completion",
    model,
    choices: [{ index: 0, message: { role: "assistant", content: "hi" } }],
    usage: {
      prompt_tokens: prompt,
      completion_tokens: completion,
      total_tokens: prompt + completion,
    },
  };
}

describe("POST /openai/* hot path", () => {
  it("forwards, meters the response, and increments the Redis counter", async () => {
    const h = await buildHarness({ adapters: [openaiAdapter] });
    h.agents.add(TOKEN, {
      id: AGENT_ID,
      status: "active",
      maxBudgetCents: 100, // $1.00 ceiling — plenty
    });

    const body = completion("gpt-4o-mini", 1000, 500);
    h.upstream.setResponder(
      () =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );

    const res = await h.app.inject({
      method: "POST",
      url: "/openai/v1/chat/completions",
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }] },
    });

    // Upstream response returned unchanged.
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(body);

    // Forwarded to the URL + auth the adapter built — never to a route constant.
    expect(h.upstream.calls).toHaveLength(1);
    const call = h.upstream.calls[0];
    expect(call?.url).toBe("https://api.openai.com/v1/chat/completions");
    const headers = call?.init?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer sk-upstream-test");

    // cost = 1000 * 15/1e6 + 500 * 60/1e6 = 0.045 cents → 45,000 micro-cents.
    const expectedMicroCents = Math.round(0.045 * MICROCENTS_PER_CENT);
    expect(h.budget.counters.get(KEY)).toBe(expectedMicroCents);

    // Settled to the audit log off the response path.
    expect(h.spendLog.events).toHaveLength(1);
    expect(h.spendLog.events[0]).toMatchObject({
      agentId: AGENT_ID,
      providerId: "openai",
      actualCostCents: 0.045,
      decision: "allowed",
      upstreamStatus: 200,
    });
  });

  it("accumulates spend across successive requests (atomic INCRBY)", async () => {
    const h = await buildHarness({ adapters: [openaiAdapter] });
    h.agents.add(TOKEN, { id: AGENT_ID, status: "active", maxBudgetCents: 100 });
    h.upstream.setResponder(
      () => new Response(JSON.stringify(completion("gpt-4o", 100, 100)), { status: 200 }),
    );

    // cost per call = 100*250/1e6 + 100*1000/1e6 = 0.125 cents → 125,000 µ¢.
    const per = Math.round(0.125 * MICROCENTS_PER_CENT);

    for (let i = 0; i < 3; i++) {
      await h.app.inject({
        method: "POST",
        url: "/openai/v1/chat/completions",
        headers: { authorization: `Bearer ${TOKEN}` },
        payload: { model: "gpt-4o" },
      });
    }

    expect(h.budget.counters.get(KEY)).toBe(per * 3);
  });

  it("denies with budget_exceeded when the counter is at/over the ceiling", async () => {
    const h = await buildHarness({ adapters: [openaiAdapter] });
    h.agents.add(TOKEN, { id: AGENT_ID, status: "active", maxBudgetCents: 50 });
    // Seed spend equal to the ceiling (50 cents = 50,000,000 micro-cents).
    h.budget.seed(KEY, 50 * MICROCENTS_PER_CENT);

    const res = await h.app.inject({
      method: "POST",
      url: "/openai/v1/chat/completions",
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { model: "gpt-4o-mini" },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "budget_exceeded" });
    // Enforcement happens before any upstream call or metering.
    expect(h.upstream.calls).toHaveLength(0);
    expect(h.budget.counters.get(KEY)).toBe(50 * MICROCENTS_PER_CENT);
    expect(h.spendLog.events).toHaveLength(0);
  });

  it("denies frozen agents with agent_frozen and never forwards", async () => {
    const h = await buildHarness({ adapters: [openaiAdapter] });
    h.agents.add(TOKEN, { id: AGENT_ID, status: "soft_frozen", maxBudgetCents: 100 });

    const res = await h.app.inject({
      method: "POST",
      url: "/openai/v1/chat/completions",
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { model: "gpt-4o-mini" },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "agent_frozen" });
    expect(h.upstream.calls).toHaveLength(0);
  });

  it("denies via the Redis frozen flag even when Postgres status is still active", async () => {
    const h = await buildHarness({ adapters: [openaiAdapter] });
    h.agents.add(TOKEN, { id: AGENT_ID, status: "active", maxBudgetCents: 100 });
    h.freeze.freeze(AGENT_ID);

    const res = await h.app.inject({
      method: "POST",
      url: "/openai/v1/chat/completions",
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { model: "gpt-4o-mini" },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "agent_frozen" });
    expect(h.upstream.calls).toHaveLength(0);
  });

  it("rejects missing/invalid tokens before touching budget or upstream", async () => {
    const h = await buildHarness({ adapters: [openaiAdapter] });

    const missing = await h.app.inject({
      method: "POST",
      url: "/openai/v1/chat/completions",
      payload: {},
    });
    expect(missing.statusCode).toBe(401);
    expect(missing.json()).toEqual({ error: "missing_token" });

    const invalid = await h.app.inject({
      method: "POST",
      url: "/openai/v1/chat/completions",
      headers: { authorization: "Bearer nope" },
      payload: {},
    });
    expect(invalid.statusCode).toBe(401);
    expect(invalid.json()).toEqual({ error: "invalid_token" });

    expect(h.upstream.calls).toHaveLength(0);
  });
});

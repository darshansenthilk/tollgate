import { describe, it, expect } from "vitest";
import { geminiAdapter } from "../src/adapters/gemini.js";
import { spendKey, currentMonth, MICROCENTS_PER_CENT } from "../src/lib/budget.js";
import { buildHarness, FIXED_NOW } from "./helpers.js";

const AGENT_ID = "agent-1";
const TOKEN = "tollgate-secret-token";
const MONTH = currentMonth(FIXED_NOW);
const KEY = spendKey(AGENT_ID, MONTH);

/**
 * A realistic Gemini generateContent response body for the mock upstream.
 * Unlike OpenAI/Claude, the model comes back as `modelVersion` — Gemini's
 * request body carries no "model" field at all (it's in the URL path
 * instead, e.g. /v1beta/models/gemini-1.5-flash:generateContent), so the
 * response is the only place parseCost can read it from.
 */
function response(modelVersion: string, promptTokens: number, candidatesTokens: number) {
  return {
    candidates: [
      { content: { role: "model", parts: [{ text: "hi" }] }, finishReason: "STOP" },
    ],
    usageMetadata: {
      promptTokenCount: promptTokens,
      candidatesTokenCount: candidatesTokens,
      totalTokenCount: promptTokens + candidatesTokens,
    },
    modelVersion,
  };
}

describe("POST /gemini/* hot path", () => {
  it("forwards, meters the response, and increments the Redis counter", async () => {
    const h = await buildHarness({ adapters: [geminiAdapter] });
    h.agents.add(TOKEN, {
      id: AGENT_ID,
      status: "active",
      maxBudgetCents: 100, // $1.00 ceiling — plenty
      providerSlug: "gemini",
    });

    const body = response("gemini-1.5-flash", 1000, 500);
    h.upstream.setResponder(
      () =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );

    const res = await h.app.inject({
      method: "POST",
      url: "/gemini/v1beta/models/gemini-1.5-flash:generateContent",
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { contents: [{ role: "user", parts: [{ text: "hi" }] }] },
    });

    // Upstream response returned unchanged.
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(body);

    // Forwarded to the URL + auth the adapter built — never to a route constant.
    expect(h.upstream.calls).toHaveLength(1);
    const call = h.upstream.calls[0];
    expect(call?.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent",
    );
    const headers = call?.init?.headers as Record<string, string>;
    expect(headers["x-goog-api-key"]).toBe("sk-upstream-test");
    expect(headers.authorization).toBeUndefined();

    // cost = 1000 * 7.5/1e6 + 500 * 30/1e6 = 0.0225 cents → 22,500 micro-cents.
    const expectedMicroCents = Math.round(0.0225 * MICROCENTS_PER_CENT);
    expect(h.budget.counters.get(KEY)).toBe(expectedMicroCents);

    // Settled to the audit log off the response path.
    expect(h.spendLog.events).toHaveLength(1);
    expect(h.spendLog.events[0]).toMatchObject({
      agentId: AGENT_ID,
      providerId: "gemini",
      actualCostCents: 0.0225,
      decision: "allowed",
      upstreamStatus: 200,
    });
  });

  it("returns cost 0 for an unrecognized modelVersion instead of crashing metering", async () => {
    const h = await buildHarness({ adapters: [geminiAdapter] });
    h.agents.add(TOKEN, {
      id: AGENT_ID,
      status: "active",
      maxBudgetCents: 100,
      providerSlug: "gemini",
    });
    h.upstream.setResponder(
      () =>
        new Response(JSON.stringify(response("gemini-3.0-future", 1000, 1000)), {
          status: 200,
        }),
    );

    const res = await h.app.inject({
      method: "POST",
      url: "/gemini/v1beta/models/gemini-3.0-future:generateContent",
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    expect(h.budget.counters.get(KEY)).toBe(0);
    expect(h.spendLog.events[0]).toMatchObject({ actualCostCents: 0 });
  });

  it("meters a streamed (alt=sse) response using the last usageMetadata frame", async () => {
    const h = await buildHarness({ adapters: [geminiAdapter] });
    h.agents.add(TOKEN, {
      id: AGENT_ID,
      status: "active",
      maxBudgetCents: 100,
      providerSlug: "gemini",
    });

    // Gemini's streaming usageMetadata is a running total per chunk, not a
    // delta — the LAST chunk's numbers are the real total (mirrors
    // Anthropic's message_delta.output_tokens; see gemini.ts's doc comment).
    const chunks = [
      response("gemini-1.5-flash", 1000, 100),
      response("gemini-1.5-flash", 1000, 500),
    ];
    const sse = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
    h.upstream.setResponder(
      () =>
        new Response(sse, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
    );

    await h.app.inject({
      method: "POST",
      url: "/gemini/v1beta/models/gemini-1.5-flash:streamGenerateContent?alt=sse",
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: {},
    });

    // Last chunk's totals: 1000 * 7.5/1e6 + 500 * 30/1e6 = 0.0225 cents.
    const expectedMicroCents = Math.round(0.0225 * MICROCENTS_PER_CENT);
    expect(h.budget.counters.get(KEY)).toBe(expectedMicroCents);
  });

  it("denies frozen agents with agent_frozen and never forwards", async () => {
    const h = await buildHarness({ adapters: [geminiAdapter] });
    h.agents.add(TOKEN, {
      id: AGENT_ID,
      status: "soft_frozen",
      maxBudgetCents: 100,
      providerSlug: "gemini",
    });

    const res = await h.app.inject({
      method: "POST",
      url: "/gemini/v1beta/models/gemini-1.5-flash:generateContent",
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: {},
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "agent_frozen" });
    expect(h.upstream.calls).toHaveLength(0);
  });

  it("denies with provider_mismatch when the agent's assistant doesn't map to this adapter", async () => {
    const h = await buildHarness({ adapters: [geminiAdapter] });
    h.agents.add(TOKEN, {
      id: AGENT_ID,
      status: "active",
      maxBudgetCents: 100,
      providerSlug: "chatgpt", // created for ChatGPT, not Gemini
    });

    const res = await h.app.inject({
      method: "POST",
      url: "/gemini/v1beta/models/gemini-1.5-flash:generateContent",
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: {},
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({
      error: "provider_mismatch",
      providerSlug: "gemini",
      assistantSlug: "chatgpt",
    });
    expect(h.upstream.calls).toHaveLength(0);
  });

  it("denies with tool_call_blocked when the response asks for a blocked tool, but still meters the real cost", async () => {
    const h = await buildHarness({ adapters: [geminiAdapter] });
    h.agents.add(TOKEN, {
      id: AGENT_ID,
      status: "active",
      maxBudgetCents: 100,
      providerSlug: "gemini",
      blockedTools: ["delete_customer"],
    });

    const body = {
      candidates: [
        {
          content: {
            role: "model",
            parts: [{ functionCall: { name: "delete_customer", args: {} } }],
          },
          finishReason: "STOP",
        },
      ],
      usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 500, totalTokenCount: 1500 },
      modelVersion: "gemini-1.5-flash",
    };
    h.upstream.setResponder(
      () =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );

    const res = await h.app.inject({
      method: "POST",
      url: "/gemini/v1beta/models/gemini-1.5-flash:generateContent",
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { contents: [{ role: "user", parts: [{ text: "delete them" }] }] },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "tool_call_blocked", tool: "delete_customer" });
    expect(h.spendLog.events[0]).toMatchObject({ decision: "denied_tool" });
    expect(h.spendLog.events[0]?.actualCostCents).toBeGreaterThan(0);
  });

  it("injects the agent's configured system prompt into systemInstruction.parts", async () => {
    const h = await buildHarness({ adapters: [geminiAdapter] });
    h.agents.add(TOKEN, {
      id: AGENT_ID,
      status: "active",
      maxBudgetCents: 100,
      providerSlug: "gemini",
      systemPrompt: "You are a helpful support agent for Acme Corp.",
    });
    h.upstream.setResponder(
      () => new Response(JSON.stringify(response("gemini-1.5-flash", 10, 10)), { status: 200 }),
    );

    await h.app.inject({
      method: "POST",
      url: "/gemini/v1beta/models/gemini-1.5-flash:generateContent",
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: {
        systemInstruction: { parts: [{ text: "Also be concise." }] },
        contents: [{ role: "user", parts: [{ text: "hi" }] }],
      },
    });

    const sentBody = JSON.parse(h.upstream.calls[0]?.init?.body as string);
    expect(sentBody.systemInstruction).toEqual({
      parts: [
        { text: "You are a helpful support agent for Acme Corp." },
        { text: "Also be concise." },
      ],
    });
    expect(sentBody.contents).toEqual([{ role: "user", parts: [{ text: "hi" }] }]);
  });

  it("appends the agent's configured tools as a new functionDeclarations entry", async () => {
    const h = await buildHarness({ adapters: [geminiAdapter] });
    h.agents.add(TOKEN, {
      id: AGENT_ID,
      status: "active",
      maxBudgetCents: 100,
      providerSlug: "gemini",
      toolDefinitions: [
        {
          name: "lookup_order",
          description: "Look up an order by id.",
          parameters: { type: "object", properties: { orderId: { type: "string" } } },
        },
      ],
    });
    h.upstream.setResponder(
      () => new Response(JSON.stringify(response("gemini-1.5-flash", 10, 10)), { status: 200 }),
    );

    await h.app.inject({
      method: "POST",
      url: "/gemini/v1beta/models/gemini-1.5-flash:generateContent",
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { contents: [{ role: "user", parts: [{ text: "hi" }] }] },
    });

    const sentBody = JSON.parse(h.upstream.calls[0]?.init?.body as string);
    expect(sentBody.tools).toEqual([
      {
        functionDeclarations: [
          {
            name: "lookup_order",
            description: "Look up an order by id.",
            parameters: { type: "object", properties: { orderId: { type: "string" } } },
          },
        ],
      },
    ]);
  });
});

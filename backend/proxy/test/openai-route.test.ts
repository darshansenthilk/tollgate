import { describe, it, expect } from "vitest";
import { openaiAdapter } from "../src/adapters/openai.js";
import { spendKey, currentMonth, MICROCENTS_PER_CENT } from "../src/lib/budget.js";
import { buildHarness, DEFAULT_TEST_ORG_ID, FIXED_NOW } from "./helpers.js";

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

/** A chat-completions response whose message asks to call one tool. */
function completionWithToolCall(
  model: string,
  prompt: number,
  completionTokens: number,
  toolName: string,
) {
  return {
    id: "chatcmpl-abc",
    object: "chat.completion",
    model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            { id: "call_1", type: "function", function: { name: toolName, arguments: "{}" } },
          ],
        },
        finish_reason: "tool_calls",
      },
    ],
    usage: {
      prompt_tokens: prompt,
      completion_tokens: completionTokens,
      total_tokens: prompt + completionTokens,
    },
  };
}

/** The same tool call, but as a streamed SSE transcript — the name arrives on
 *  the chunk that introduces the call, usage on the final summary chunk (see
 *  prepareStreamUsage's doc comment for why that chunk exists at all). */
function streamedToolCall(
  model: string,
  prompt: number,
  completionTokens: number,
  toolName: string,
): string {
  const frames = [
    {
      id: "chatcmpl-abc",
      object: "chat.completion.chunk",
      model,
      choices: [
        {
          index: 0,
          delta: {
            role: "assistant",
            tool_calls: [
              { index: 0, id: "call_1", type: "function", function: { name: toolName, arguments: "" } },
            ],
          },
          finish_reason: null,
        },
      ],
    },
    {
      id: "chatcmpl-abc",
      object: "chat.completion.chunk",
      model,
      choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: "{}" } }] }, finish_reason: null }],
    },
    {
      id: "chatcmpl-abc",
      object: "chat.completion.chunk",
      model,
      choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
    },
    {
      id: "chatcmpl-abc",
      object: "chat.completion.chunk",
      model,
      choices: [],
      usage: {
        prompt_tokens: prompt,
        completion_tokens: completionTokens,
        total_tokens: prompt + completionTokens,
      },
    },
  ];
  return frames.map((f) => `data: ${JSON.stringify(f)}`).join("\n\n") + "\n\ndata: [DONE]\n\n";
}

describe("POST /openai/* hot path", () => {
  it("forwards, meters the response, and increments the Redis counter", async () => {
    const h = await buildHarness({ adapters: [openaiAdapter] });
    h.agents.add(TOKEN, {
      id: AGENT_ID,
      status: "active",
      maxBudgetCents: 100, // $1.00 ceiling — plenty
      providerSlug: "chatgpt",
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
    h.agents.add(TOKEN, {
      id: AGENT_ID,
      status: "active",
      maxBudgetCents: 100,
      providerSlug: "chatgpt",
    });
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
    h.agents.add(TOKEN, {
      id: AGENT_ID,
      status: "active",
      maxBudgetCents: 50,
      providerSlug: "chatgpt",
    });
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
    // The denial IS audited (it's what the dashboard's activity log surfaces),
    // but at zero cost — nothing was forwarded, so nothing was spent.
    expect(h.spendLog.events).toHaveLength(1);
    expect(h.spendLog.events[0]).toMatchObject({
      agentId: AGENT_ID,
      decision: "denied_budget",
      actualCostCents: 0,
      model: null,
      promptTokens: null,
      completionTokens: null,
    });
  });

  it("denies frozen agents with agent_frozen and never forwards", async () => {
    const h = await buildHarness({ adapters: [openaiAdapter] });
    h.agents.add(TOKEN, {
      id: AGENT_ID,
      status: "soft_frozen",
      maxBudgetCents: 100,
      providerSlug: "chatgpt",
    });

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
    h.agents.add(TOKEN, {
      id: AGENT_ID,
      status: "active",
      maxBudgetCents: 100,
      providerSlug: "chatgpt",
    });
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

  it("denies with provider_mismatch when the agent's assistant doesn't map to this adapter", async () => {
    const h = await buildHarness({ adapters: [openaiAdapter] });
    h.agents.add(TOKEN, {
      id: AGENT_ID,
      status: "active",
      maxBudgetCents: 100,
      providerSlug: "claude", // created for Claude, not ChatGPT
    });

    const res = await h.app.inject({
      method: "POST",
      url: "/openai/v1/chat/completions",
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { model: "gpt-4o-mini" },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({
      error: "provider_mismatch",
      providerSlug: "openai",
      assistantSlug: "claude",
    });
    expect(h.upstream.calls).toHaveLength(0);
  });

  it("denies with tool_call_blocked when the response asks for a blocked tool, but still meters the real cost", async () => {
    const h = await buildHarness({ adapters: [openaiAdapter] });
    h.agents.add(TOKEN, {
      id: AGENT_ID,
      status: "active",
      maxBudgetCents: 100,
      providerSlug: "chatgpt",
      blockedTools: ["delete_customer"],
    });

    const body = completionWithToolCall("gpt-4o-mini", 1000, 500, "delete_customer");
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
      payload: { model: "gpt-4o-mini", messages: [{ role: "user", content: "delete them" }] },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "tool_call_blocked", tool: "delete_customer" });

    // The upstream call genuinely happened — tokens were spent producing this
    // response — so unlike the frozen/budget gates, this is metered.
    expect(h.upstream.calls).toHaveLength(1);
    const expectedMicroCents = Math.round(0.045 * MICROCENTS_PER_CENT);
    expect(h.budget.counters.get(KEY)).toBe(expectedMicroCents);

    expect(h.spendLog.events).toHaveLength(1);
    expect(h.spendLog.events[0]).toMatchObject({
      agentId: AGENT_ID,
      decision: "denied_tool",
      actualCostCents: 0.045,
      upstreamStatus: 200,
    });

    // The denial isn't a dead end: an escalation an operator can approve was
    // queued alongside it.
    expect(h.approvals.requests).toEqual([
      { orgId: DEFAULT_TEST_ORG_ID, agentId: AGENT_ID, toolName: "delete_customer" },
    ]);
  });

  it("lets a blocked tool through once when an operator has granted it, and spends the grant", async () => {
    const h = await buildHarness({ adapters: [openaiAdapter] });
    h.agents.add(TOKEN, {
      id: AGENT_ID,
      status: "active",
      maxBudgetCents: 100,
      providerSlug: "chatgpt",
      blockedTools: ["delete_customer"],
    });
    h.approvals.grant(AGENT_ID, "delete_customer");

    const body = completionWithToolCall("gpt-4o-mini", 1000, 500, "delete_customer");
    h.upstream.setResponder(
      () => new Response(JSON.stringify(body), { status: 200 }),
    );

    const send = () =>
      h.app.inject({
        method: "POST",
        url: "/openai/v1/chat/completions",
        headers: { authorization: `Bearer ${TOKEN}` },
        payload: { model: "gpt-4o-mini" },
      });

    // First attempt spends the operator's one-time approval.
    const approved = await send();
    expect(approved.statusCode).toBe(200);
    expect(approved.json()).toEqual(body);
    expect(h.spendLog.events[0]).toMatchObject({ decision: "allowed" });
    // Nothing to escalate — it was already approved.
    expect(h.approvals.requests).toHaveLength(0);

    // Second attempt finds the grant spent: approving one call must not open a
    // window in which the agent can keep calling the blocked tool.
    const afterwards = await send();
    expect(afterwards.statusCode).toBe(403);
    expect(afterwards.json()).toEqual({ error: "tool_call_blocked", tool: "delete_customer" });
    expect(h.approvals.requests).toHaveLength(1);
  });

  it("does not let a granted tool smuggle an ungranted one through in the same response", async () => {
    const h = await buildHarness({ adapters: [openaiAdapter] });
    h.agents.add(TOKEN, {
      id: AGENT_ID,
      status: "active",
      maxBudgetCents: 100,
      providerSlug: "chatgpt",
      blockedTools: ["delete_customer", "send_payment"],
    });
    // The operator approved exactly one of the two.
    h.approvals.grant(AGENT_ID, "delete_customer");

    // One response asking for both — checking only the first blocked call
    // would approve this whole response off the back of one approval.
    const body = {
      id: "chatcmpl-abc",
      object: "chat.completion",
      model: "gpt-4o-mini",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              { id: "call_1", type: "function", function: { name: "delete_customer", arguments: "{}" } },
              { id: "call_2", type: "function", function: { name: "send_payment", arguments: "{}" } },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
    };
    h.upstream.setResponder(() => new Response(JSON.stringify(body), { status: 200 }));

    const res = await h.app.inject({
      method: "POST",
      url: "/openai/v1/chat/completions",
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { model: "gpt-4o-mini" },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "tool_call_blocked", tool: "send_payment" });
    // Only the unapproved one is escalated; the approved one needed no decision.
    expect(h.approvals.requests).toEqual([
      { orgId: DEFAULT_TEST_ORG_ID, agentId: AGENT_ID, toolName: "send_payment" },
    ]);
  });

  it("raises only one pending escalation when an agent retries a blocked call in a loop", async () => {
    const h = await buildHarness({ adapters: [openaiAdapter] });
    h.agents.add(TOKEN, {
      id: AGENT_ID,
      status: "active",
      maxBudgetCents: 100,
      providerSlug: "chatgpt",
      blockedTools: ["delete_customer"],
    });
    h.upstream.setResponder(
      () =>
        new Response(
          JSON.stringify(completionWithToolCall("gpt-4o-mini", 10, 10, "delete_customer")),
          { status: 200 },
        ),
    );

    for (let i = 0; i < 3; i++) {
      await h.app.inject({
        method: "POST",
        url: "/openai/v1/chat/completions",
        headers: { authorization: `Bearer ${TOKEN}` },
        payload: { model: "gpt-4o-mini" },
      });
    }

    // Three denials in the audit log, but one row in the operator's queue.
    expect(h.spendLog.events).toHaveLength(3);
    expect(h.approvals.requests).toHaveLength(1);
  });

  it("catches a blocked tool call split across a streamed transcript", async () => {
    const h = await buildHarness({ adapters: [openaiAdapter] });
    h.agents.add(TOKEN, {
      id: AGENT_ID,
      status: "active",
      maxBudgetCents: 100,
      providerSlug: "chatgpt",
      blockedTools: ["delete_customer"],
    });

    const transcript = streamedToolCall("gpt-4o-mini", 1000, 500, "delete_customer");
    h.upstream.setResponder(
      () =>
        new Response(transcript, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
    );

    const res = await h.app.inject({
      method: "POST",
      url: "/openai/v1/chat/completions",
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { model: "gpt-4o-mini", stream: true },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "tool_call_blocked", tool: "delete_customer" });
    expect(h.spendLog.events[0]).toMatchObject({ decision: "denied_tool" });
  });

  it("allows a tool call the agent's policy doesn't block", async () => {
    const h = await buildHarness({ adapters: [openaiAdapter] });
    h.agents.add(TOKEN, {
      id: AGENT_ID,
      status: "active",
      maxBudgetCents: 100,
      providerSlug: "chatgpt",
      blockedTools: ["delete_customer"],
    });

    const body = completionWithToolCall("gpt-4o-mini", 1000, 500, "lookup_order");
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
      payload: { model: "gpt-4o-mini" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(body);
    expect(h.spendLog.events[0]).toMatchObject({ decision: "allowed" });
  });

  it("injects the agent's configured system prompt as the first message, keeping the caller's own messages", async () => {
    const h = await buildHarness({ adapters: [openaiAdapter] });
    h.agents.add(TOKEN, {
      id: AGENT_ID,
      status: "active",
      maxBudgetCents: 100,
      providerSlug: "chatgpt",
      systemPrompt: "You are a helpful support agent for Acme Corp.",
    });
    h.upstream.setResponder(
      () => new Response(JSON.stringify(completion("gpt-4o-mini", 10, 10)), { status: 200 }),
    );

    await h.app.inject({
      method: "POST",
      url: "/openai/v1/chat/completions",
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: {
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "Also be concise." },
          { role: "user", content: "hi" },
        ],
      },
    });

    expect(h.upstream.calls).toHaveLength(1);
    const sentBody = JSON.parse(h.upstream.calls[0]?.init?.body as string);
    expect(sentBody.messages).toEqual([
      { role: "system", content: "You are a helpful support agent for Acme Corp." },
      { role: "system", content: "Also be concise." },
      { role: "user", content: "hi" },
    ]);
  });

  it("leaves the request body untouched when the agent has no system prompt configured", async () => {
    const h = await buildHarness({ adapters: [openaiAdapter] });
    h.agents.add(TOKEN, {
      id: AGENT_ID,
      status: "active",
      maxBudgetCents: 100,
      providerSlug: "chatgpt",
    });
    h.upstream.setResponder(
      () => new Response(JSON.stringify(completion("gpt-4o-mini", 10, 10)), { status: 200 }),
    );

    const payload = { model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }] };
    await h.app.inject({
      method: "POST",
      url: "/openai/v1/chat/completions",
      headers: { authorization: `Bearer ${TOKEN}` },
      payload,
    });

    const sentBody = JSON.parse(h.upstream.calls[0]?.init?.body as string);
    expect(sentBody.messages).toEqual(payload.messages);
  });

  it("appends the agent's configured tools to the caller's own tools array", async () => {
    const h = await buildHarness({ adapters: [openaiAdapter] });
    h.agents.add(TOKEN, {
      id: AGENT_ID,
      status: "active",
      maxBudgetCents: 100,
      providerSlug: "chatgpt",
      toolDefinitions: [
        {
          name: "lookup_order",
          description: "Look up an order by id.",
          parameters: { type: "object", properties: { orderId: { type: "string" } } },
        },
      ],
    });
    h.upstream.setResponder(
      () => new Response(JSON.stringify(completion("gpt-4o-mini", 10, 10)), { status: 200 }),
    );

    await h.app.inject({
      method: "POST",
      url: "/openai/v1/chat/completions",
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: {
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "hi" }],
        tools: [{ type: "function", function: { name: "callers_own_tool", description: "d", parameters: {} } }],
      },
    });

    const sentBody = JSON.parse(h.upstream.calls[0]?.init?.body as string);
    expect(sentBody.tools).toEqual([
      { type: "function", function: { name: "callers_own_tool", description: "d", parameters: {} } },
      {
        type: "function",
        function: {
          name: "lookup_order",
          description: "Look up an order by id.",
          parameters: { type: "object", properties: { orderId: { type: "string" } } },
        },
      },
    ]);
  });

  it("does not advertise a configured tool that's also on the blocklist", async () => {
    const h = await buildHarness({ adapters: [openaiAdapter] });
    h.agents.add(TOKEN, {
      id: AGENT_ID,
      status: "active",
      maxBudgetCents: 100,
      providerSlug: "chatgpt",
      blockedTools: ["delete_customer"],
      toolDefinitions: [
        { name: "lookup_order", description: "d1", parameters: {} },
        { name: "delete_customer", description: "d2", parameters: {} },
      ],
    });
    h.upstream.setResponder(
      () => new Response(JSON.stringify(completion("gpt-4o-mini", 10, 10)), { status: 200 }),
    );

    await h.app.inject({
      method: "POST",
      url: "/openai/v1/chat/completions",
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }] },
    });

    const sentBody = JSON.parse(h.upstream.calls[0]?.init?.body as string);
    const names = sentBody.tools.map((t: { function: { name: string } }) => t.function.name);
    expect(names).toEqual(["lookup_order"]);
  });

  it("leaves tools untouched when the agent has none configured", async () => {
    const h = await buildHarness({ adapters: [openaiAdapter] });
    h.agents.add(TOKEN, {
      id: AGENT_ID,
      status: "active",
      maxBudgetCents: 100,
      providerSlug: "chatgpt",
    });
    h.upstream.setResponder(
      () => new Response(JSON.stringify(completion("gpt-4o-mini", 10, 10)), { status: 200 }),
    );

    const payload = { model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }] };
    await h.app.inject({
      method: "POST",
      url: "/openai/v1/chat/completions",
      headers: { authorization: `Bearer ${TOKEN}` },
      payload,
    });

    const sentBody = JSON.parse(h.upstream.calls[0]?.init?.body as string);
    expect(sentBody.tools).toBeUndefined();
  });

  it("records the forwarded prompt on the audit row, truncating an oversized one", async () => {
    const h = await buildHarness({ adapters: [openaiAdapter] });
    h.agents.add(TOKEN, {
      id: AGENT_ID,
      status: "active",
      maxBudgetCents: 100,
      providerSlug: "chatgpt",
    });
    h.upstream.setResponder(
      () => new Response(JSON.stringify(completion("gpt-4o-mini", 10, 10)), { status: 200 }),
    );

    await h.app.inject({
      method: "POST",
      url: "/openai/v1/chat/completions",
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { model: "gpt-4o-mini", messages: [{ role: "user", content: "refund order 4471" }] },
    });

    const recorded = h.spendLog.events[0]?.prompt;
    expect(recorded).toContain("refund order 4471");

    // An agent pasting a huge document must not grow spend_events without
    // bound — and the truncation has to be visible, not silent.
    const huge = "x".repeat(20_000);
    await h.app.inject({
      method: "POST",
      url: "/openai/v1/chat/completions",
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { model: "gpt-4o-mini", messages: [{ role: "user", content: huge }] },
    });

    const truncated = h.spendLog.events[1]?.prompt ?? "";
    expect(truncated.length).toBeLessThan(9_000);
    expect(truncated).toContain("[truncated by Tollgate]");
  });

  it("records no prompt on a denial caught before anything was forwarded", async () => {
    const h = await buildHarness({ adapters: [openaiAdapter] });
    h.agents.add(TOKEN, {
      id: AGENT_ID,
      status: "soft_frozen",
      maxBudgetCents: 100,
      providerSlug: "chatgpt",
    });

    await h.app.inject({
      method: "POST",
      url: "/openai/v1/chat/completions",
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { model: "gpt-4o-mini", messages: [{ role: "user", content: "secret" }] },
    });

    expect(h.upstream.calls).toHaveLength(0);
    expect(h.spendLog.events[0]).toMatchObject({ decision: "denied_frozen", prompt: null });
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

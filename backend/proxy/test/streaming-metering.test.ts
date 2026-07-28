import { describe, it, expect } from "vitest";
import { MICROCENTS_PER_CENT, spendKey } from "@tollgate/shared";
import { openaiAdapter } from "../src/adapters/openai.js";
import { claudeAdapter } from "../src/adapters/claude.js";
import { buildHarness, FIXED_NOW } from "./helpers.js";

/**
 * Regression tests for the bug where a streamed response metered as $0.
 *
 * The proxy buffers the upstream body and meters it. A streamed response is an
 * SSE transcript, not JSON, so JSON.parse failed and parseCost returned a cost
 * of zero — meaning a streaming agent could spend without limit while Tollgate
 * recorded nothing and the budget gate never fired.
 */

const TOKEN = "tg_stream_test_token";
const AGENT_ID = "22222222-2222-4222-8222-222222222222";
const KEY = spendKey(AGENT_ID, "2026-07");

/** A realistic OpenAI stream WITH the usage chunk include_usage produces:
 *  usage is non-null only on the final chunk, whose choices array is empty. */
function openaiStream(model: string, prompt: number, completion: number): string {
  return [
    `data: {"id":"c1","object":"chat.completion.chunk","model":"${model}","choices":[{"index":0,"delta":{"content":"He"}}],"usage":null}`,
    "",
    `data: {"id":"c1","object":"chat.completion.chunk","model":"${model}","choices":[{"index":0,"delta":{"content":"llo"}}],"usage":null}`,
    "",
    `data: {"id":"c1","object":"chat.completion.chunk","model":"${model}","choices":[],"usage":{"prompt_tokens":${prompt},"completion_tokens":${completion},"total_tokens":${prompt + completion}}}`,
    "",
    "data: [DONE]",
    "",
  ].join("\n");
}

/** A realistic Anthropic stream. Note output_tokens on message_delta is
 *  CUMULATIVE per the API docs — the last one is the total, not a sum. */
function claudeStream(model: string, input: number, output: number): string {
  return [
    "event: message_start",
    `data: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"${model}","content":[],"usage":{"input_tokens":${input},"output_tokens":1}}}`,
    "",
    "event: content_block_delta",
    `data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}`,
    "",
    "event: message_delta",
    `data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":${Math.floor(output / 2)}}}`,
    "",
    "event: message_delta",
    `data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":${output}}}`,
    "",
    "event: message_stop",
    `data: {"type":"message_stop"}`,
    "",
  ].join("\n");
}

describe("streamed responses are metered, not treated as free", () => {
  it("meters an OpenAI SSE response and bumps the budget counter", async () => {
    const h = await buildHarness({ adapters: [openaiAdapter] });
    h.agents.add(TOKEN, {
      id: AGENT_ID,
      status: "active",
      maxBudgetCents: 1000,
      providerSlug: "chatgpt",
    });

    h.upstream.setResponder(
      () =>
        new Response(openaiStream("gpt-4o-mini", 1000, 500), {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
    );

    await h.app.inject({
      method: "POST",
      url: "/openai/v1/chat/completions",
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { model: "gpt-4o-mini", stream: true, messages: [] },
    });

    // gpt-4o-mini: 15c/Mtok in, 60c/Mtok out.
    // 1000 * 15/1e6 + 500 * 60/1e6 = 0.015 + 0.03 = 0.045 cents.
    const expected = Math.round(0.045 * MICROCENTS_PER_CENT);
    expect(h.budget.counters.get(KEY)).toBe(expected);
    expect(h.budget.counters.get(KEY)).toBeGreaterThan(0);

    expect(h.tokenUsage.counters.get(`tokens:${AGENT_ID}:2026-07`)).toBe(1500);
    expect(h.spendLog.events[0]).toMatchObject({
      decision: "allowed",
      model: "gpt-4o-mini",
      promptTokens: 1000,
      completionTokens: 500,
    });
  });

  it("forces stream_options.include_usage onto OpenAI streaming requests", async () => {
    const h = await buildHarness({ adapters: [openaiAdapter] });
    h.agents.add(TOKEN, {
      id: AGENT_ID,
      status: "active",
      maxBudgetCents: 1000,
      providerSlug: "chatgpt",
    });
    h.upstream.setResponder(
      () => new Response(openaiStream("gpt-4o-mini", 10, 10), { status: 200 }),
    );

    await h.app.inject({
      method: "POST",
      url: "/openai/v1/chat/completions",
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { model: "gpt-4o-mini", stream: true, messages: [] },
    });

    // Without this OpenAI reports no usage at all on a stream, and there'd be
    // nothing to meter no matter how good the parser is.
    const sent = JSON.parse(String(h.upstream.calls[0]?.init?.body));
    expect(sent.stream_options).toEqual({ include_usage: true });
  });

  it("leaves non-streaming request bodies untouched", async () => {
    const h = await buildHarness({ adapters: [openaiAdapter] });
    h.agents.add(TOKEN, {
      id: AGENT_ID,
      status: "active",
      maxBudgetCents: 1000,
      providerSlug: "chatgpt",
    });
    h.upstream.setResponder(() => new Response("{}", { status: 200 }));

    await h.app.inject({
      method: "POST",
      url: "/openai/v1/chat/completions",
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { model: "gpt-4o-mini", messages: [] },
    });

    const sent = JSON.parse(String(h.upstream.calls[0]?.init?.body));
    expect(sent.stream_options).toBeUndefined();
  });

  it("meters an Anthropic SSE response, treating output_tokens as cumulative", async () => {
    const h = await buildHarness({ adapters: [claudeAdapter] });
    h.agents.add(TOKEN, {
      id: AGENT_ID,
      status: "active",
      maxBudgetCents: 1000,
      providerSlug: "claude",
    });

    h.upstream.setResponder(
      () =>
        new Response(claudeStream("claude-3-5-haiku-20241022", 1000, 400), {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
    );

    await h.app.inject({
      method: "POST",
      url: "/claude/v1/messages",
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { model: "claude-3-5-haiku-20241022", stream: true, messages: [] },
    });

    // haiku: 80c/Mtok in, 400c/Mtok out.
    // 1000 * 80/1e6 + 400 * 400/1e6 = 0.08 + 0.16 = 0.24 cents.
    // If the two message_delta frames were SUMMED instead of overwritten the
    // output would be 600, not 400 — this asserts the cumulative semantics.
    const expected = Math.round(0.24 * MICROCENTS_PER_CENT);
    expect(h.budget.counters.get(KEY)).toBe(expected);

    expect(h.spendLog.events[0]).toMatchObject({
      decision: "allowed",
      model: "claude-3-5-haiku-20241022",
      promptTokens: 1000,
      completionTokens: 400,
    });
  });

  it("a streamed request still trips the budget gate on the NEXT call", async () => {
    // The end-to-end point of the fix: streamed spend accumulates, so the gate
    // eventually fires. Before, the counter stayed at 0 forever.
    const h = await buildHarness({ adapters: [openaiAdapter] });
    h.agents.add(TOKEN, {
      id: AGENT_ID,
      status: "active",
      maxBudgetCents: 1, // 1 cent ceiling
      providerSlug: "chatgpt",
    });

    // ~0.9 cents of spend: 20k prompt + 10k completion on gpt-4o-mini.
    h.upstream.setResponder(
      () => new Response(openaiStream("gpt-4o-mini", 20000, 10000), { status: 200 }),
    );

    const first = await h.app.inject({
      method: "POST",
      url: "/openai/v1/chat/completions",
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { model: "gpt-4o-mini", stream: true, messages: [] },
    });
    expect(first.statusCode).toBe(200);

    // Second identical call pushes cumulative spend past the ceiling.
    await h.app.inject({
      method: "POST",
      url: "/openai/v1/chat/completions",
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { model: "gpt-4o-mini", stream: true, messages: [] },
    });

    const third = await h.app.inject({
      method: "POST",
      url: "/openai/v1/chat/completions",
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { model: "gpt-4o-mini", stream: true, messages: [] },
    });

    expect(third.statusCode).toBe(403);
    expect(third.json()).toEqual({ error: "budget_exceeded" });
  });

  it("still meters ordinary JSON responses (no regression)", async () => {
    const h = await buildHarness({ adapters: [openaiAdapter] });
    h.agents.add(TOKEN, {
      id: AGENT_ID,
      status: "active",
      maxBudgetCents: 1000,
      providerSlug: "chatgpt",
    });

    h.upstream.setResponder(
      () =>
        new Response(
          JSON.stringify({
            model: "gpt-4o-mini",
            usage: { prompt_tokens: 1000, completion_tokens: 500 },
          }),
          { status: 200 },
        ),
    );

    await h.app.inject({
      method: "POST",
      url: "/openai/v1/chat/completions",
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { model: "gpt-4o-mini", messages: [] },
    });

    expect(h.budget.counters.get(KEY)).toBe(Math.round(0.045 * MICROCENTS_PER_CENT));
  });

  it("FIXED_NOW keeps the month key stable for these assertions", () => {
    expect(FIXED_NOW.toISOString().startsWith("2026-07")).toBe(true);
  });
});

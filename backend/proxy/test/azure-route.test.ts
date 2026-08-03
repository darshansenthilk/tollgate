import { describe, it, expect } from "vitest";
import { azureAdapter } from "../src/adapters/azure.js";
import { spendKey, currentMonth, MICROCENTS_PER_CENT } from "../src/lib/budget.js";
import { buildHarness, FIXED_NOW, FakeVault } from "./helpers.js";

const AGENT_ID = "agent-1";
const TOKEN = "tollgate-secret-token";
const MONTH = currentMonth(FIXED_NOW);
const KEY = spendKey(AGENT_ID, MONTH);

/** A complete Azure credential: the api key is the secret, the resource name
 *  is non-secret config (it's the hostname, which appears in every URL). */
const AZURE_CREDENTIAL = {
  secrets: { apiKey: "azure-secret-key" },
  config: { resourceName: "my-company" },
};

/**
 * Azure returns byte-identical bodies to OpenAI's chat-completions API — same
 * `usage` shape — but reports the underlying dated model version rather than
 * the customer's deployment name.
 */
function response(model: string, promptTokens: number, completionTokens: number) {
  return {
    id: "chatcmpl-abc",
    object: "chat.completion",
    model,
    choices: [{ index: 0, message: { role: "assistant", content: "hi" }, finish_reason: "stop" }],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  };
}

/** The path an Azure SDK builds on its own, given a Tollgate base URL. */
const AZURE_PATH =
  "/azure/openai/deployments/my-gpt4o/chat/completions?api-version=2024-10-21";

describe("POST /azure/* hot path", () => {
  it("forwards to the org's own Azure host with api-key auth, preserving api-version", async () => {
    const h = await buildHarness({
      adapters: [azureAdapter],
      vault: new FakeVault(AZURE_CREDENTIAL),
    });
    h.agents.add(TOKEN, {
      id: AGENT_ID,
      status: "active",
      maxBudgetCents: 100,
      providerSlug: "azure",
    });

    const body = response("gpt-4o-2024-08-06", 1000, 500);
    h.upstream.setResponder(
      () =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );

    const res = await h.app.inject({
      method: "POST",
      url: AZURE_PATH,
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { messages: [{ role: "user", content: "hi" }] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(body);

    const call = h.upstream.calls[0];
    // Host comes from the credential, not a constant — that's the whole point
    // of Azure being per-customer. api-version MUST survive: Azure rejects
    // any request without it.
    expect(call?.url).toBe(
      "https://my-company.openai.azure.com/openai/deployments/my-gpt4o/chat/completions?api-version=2024-10-21",
    );

    const headers = call?.init?.headers as Record<string, string>;
    expect(headers["api-key"]).toBe("azure-secret-key");
    // Azure ignores bearer auth entirely — sending OpenAI's header shape here
    // would 401 in a way that looks like a bad key rather than a wrong scheme.
    expect(headers.authorization).toBeUndefined();

    // cost = 1000 * 250/1e6 + 500 * 1000/1e6 = 0.75 cents.
    expect(h.budget.counters.get(KEY)).toBe(Math.round(0.75 * MICROCENTS_PER_CENT));
    expect(h.spendLog.events[0]).toMatchObject({
      agentId: AGENT_ID,
      providerId: "azure",
      actualCostCents: 0.75,
      decision: "allowed",
      model: "gpt-4o-2024-08-06",
    });
  });

  it("meters a streamed response using the final usage chunk", async () => {
    const h = await buildHarness({
      adapters: [azureAdapter],
      vault: new FakeVault(AZURE_CREDENTIAL),
    });
    h.agents.add(TOKEN, {
      id: AGENT_ID,
      status: "active",
      maxBudgetCents: 100,
      providerSlug: "azure",
    });

    // Same shape OpenAI streams: content chunks carry usage: null, and one
    // final chunk (present only because prepareRequestBody opts in) carries
    // the totals with an empty choices array.
    const sse =
      `data: ${JSON.stringify({ model: "gpt-4o-mini-2024-07-18", choices: [{ delta: { content: "hi" } }], usage: null })}\n\n` +
      `data: ${JSON.stringify({ model: "gpt-4o-mini-2024-07-18", choices: [], usage: { prompt_tokens: 2000, completion_tokens: 1000 } })}\n\n` +
      "data: [DONE]\n\n";
    h.upstream.setResponder(
      () =>
        new Response(sse, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
    );

    await h.app.inject({
      method: "POST",
      url: AZURE_PATH,
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { stream: true, messages: [] },
    });

    // The proxy must have forced usage reporting on, or there'd be nothing to
    // meter and a streaming agent would spend against a budget that never moves.
    const sent = JSON.parse(h.upstream.calls[0]?.init?.body as string) as Record<string, unknown>;
    expect(sent["stream_options"]).toEqual({ include_usage: true });

    // cost = 2000 * 15/1e6 + 1000 * 60/1e6 = 0.09 cents.
    expect(h.budget.counters.get(KEY)).toBe(Math.round(0.09 * MICROCENTS_PER_CENT));
  });

  it("returns cost 0 for an unpriced deployment instead of crashing metering", async () => {
    const h = await buildHarness({
      adapters: [azureAdapter],
      vault: new FakeVault(AZURE_CREDENTIAL),
    });
    h.agents.add(TOKEN, {
      id: AGENT_ID,
      status: "active",
      maxBudgetCents: 100,
      providerSlug: "azure",
    });
    h.upstream.setResponder(
      () => new Response(JSON.stringify(response("gpt-5-unreleased", 1000, 1000)), { status: 200 }),
    );

    const res = await h.app.inject({
      method: "POST",
      url: AZURE_PATH,
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    expect(h.budget.counters.get(KEY)).toBe(0);
    // Tokens are still reported — an unpriceable model still has real usage.
    expect(h.spendLog.events[0]).toMatchObject({
      actualCostCents: 0,
      promptTokens: 1000,
      completionTokens: 1000,
    });
  });

  it("denies with upstream_credential_incomplete when no resource name is saved", async () => {
    // A key stored without its resource name can't address any host. This must
    // be a clear, distinct failure rather than a DNS error against a nonsense
    // hostname — and nothing may be forwarded.
    const h = await buildHarness({
      adapters: [azureAdapter],
      vault: new FakeVault({ secrets: { apiKey: "azure-secret-key" }, config: {} }),
    });
    h.agents.add(TOKEN, {
      id: AGENT_ID,
      status: "active",
      maxBudgetCents: 100,
      providerSlug: "azure",
    });

    const res = await h.app.inject({
      method: "POST",
      url: AZURE_PATH,
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: {},
    });

    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ error: "upstream_credential_incomplete" });
    expect(h.upstream.calls).toHaveLength(0);
  });

  it("refuses a resource name that would escape the azure hostname", async () => {
    // The resource name is interpolated straight into the upstream host, so a
    // value containing a slash or dot could redirect an org's traffic (and its
    // api key) to an attacker-chosen server. Stored config is org-supplied, so
    // this is validated rather than trusted.
    const h = await buildHarness({
      adapters: [azureAdapter],
      vault: new FakeVault({
        secrets: { apiKey: "azure-secret-key" },
        config: { resourceName: "evil.example.com/x" },
      }),
    });
    h.agents.add(TOKEN, {
      id: AGENT_ID,
      status: "active",
      maxBudgetCents: 100,
      providerSlug: "azure",
    });

    const res = await h.app.inject({
      method: "POST",
      url: AZURE_PATH,
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: {},
    });

    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ error: "upstream_credential_incomplete" });
    // The critical assertion: the key never left the process.
    expect(h.upstream.calls).toHaveLength(0);
  });

  it("denies with provider_mismatch when the agent's assistant isn't azure", async () => {
    const h = await buildHarness({
      adapters: [azureAdapter],
      vault: new FakeVault(AZURE_CREDENTIAL),
    });
    h.agents.add(TOKEN, {
      id: AGENT_ID,
      status: "active",
      maxBudgetCents: 100,
      providerSlug: "chatgpt", // created for OpenAI proper, not Azure
    });

    const res = await h.app.inject({
      method: "POST",
      url: AZURE_PATH,
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: {},
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({
      error: "provider_mismatch",
      providerSlug: "azure",
      assistantSlug: "chatgpt",
    });
    expect(h.upstream.calls).toHaveLength(0);
  });
});

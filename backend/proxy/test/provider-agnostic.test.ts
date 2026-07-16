import { describe, it, expect } from "vitest";
import type { ProviderAdapter } from "@tollgate/shared";
import { spendKey, currentMonth, centsToMicroCents } from "../src/lib/budget.js";
import { buildHarness, FIXED_NOW, FakeVault } from "./helpers.js";

/**
 * A second, entirely fictional provider. It shares nothing with OpenAI: its own
 * base URL, a header-style auth scheme, a different URL layout, and a flat cost.
 * If the same route handler drives it correctly, the hot path provably contains
 * no OpenAI-specific logic — dispatch is 100% through the adapter interface.
 */
const acmeAdapter: ProviderAdapter = {
  slug: "acme",
  baseUrl: "https://acme.example/api",
  buildAuthHeaders: (key) => ({ "x-acme-key": key }),
  buildUpstreamUrl: (path) => `https://acme.example/api/v2/${path}`,
  parseCost: () => ({ costCents: 3, estimatedCostCents: 5 }),
};

/**
 * A fictional assistant→adapter mapping, disjoint from the real
 * chatgpt/claude one — proves the assistant gate is also driven entirely
 * through injection, with no adapter names hardcoded in the route handler.
 */
const acmeAssistantAdapterSlugs = new Map([["acme-assistant", "acme"]]);

const AGENT_ID = "agent-acme";
const TOKEN = "acme-token";
const KEY = spendKey(AGENT_ID, currentMonth(FIXED_NOW));

describe("route handler is provider-agnostic", () => {
  it("drives a non-OpenAI adapter through the identical code path", async () => {
    const h = await buildHarness({
      adapters: [acmeAdapter],
      vault: new FakeVault("acme-upstream-key"),
      assistantAdapterSlugs: acmeAssistantAdapterSlugs,
    });
    h.agents.add(TOKEN, {
      id: AGENT_ID,
      status: "active",
      maxBudgetCents: 100,
      providerSlug: "acme-assistant",
    });

    const upstreamBody = { ok: true, note: "acme response" };
    h.upstream.setResponder(
      () =>
        new Response(JSON.stringify(upstreamBody), {
          status: 201,
          headers: { "content-type": "application/json" },
        }),
    );

    const res = await h.app.inject({
      method: "POST",
      url: "/acme/widgets/create",
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { size: "large" },
    });

    // Upstream response returned unchanged, including its status code.
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual(upstreamBody);

    // Routed via the adapter's URL builder and auth scheme — not OpenAI's.
    const call = h.upstream.calls[0];
    expect(call?.url).toBe("https://acme.example/api/v2/widgets/create");
    const headers = call?.init?.headers as Record<string, string>;
    expect(headers["x-acme-key"]).toBe("acme-upstream-key");
    expect(headers.authorization).toBeUndefined();

    // Metered with the adapter's own cost function.
    expect(h.budget.counters.get(KEY)).toBe(centsToMicroCents(3));
    expect(h.spendLog.events[0]).toMatchObject({
      providerId: "acme",
      actualCostCents: 3,
      estimatedCostCents: 5,
    });
  });

  it("knows no provider it wasn't given: /openai 404s under an acme-only registry", async () => {
    const h = await buildHarness({
      adapters: [acmeAdapter],
      assistantAdapterSlugs: acmeAssistantAdapterSlugs,
    });
    h.agents.add(TOKEN, {
      id: AGENT_ID,
      status: "active",
      maxBudgetCents: 100,
      providerSlug: "acme-assistant",
    });

    const res = await h.app.inject({
      method: "POST",
      url: "/openai/chat/completions",
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { model: "gpt-4o-mini" },
    });

    // No hardcoded OpenAI fallback exists in the handler.
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "unknown_provider", providerSlug: "openai" });
    expect(h.upstream.calls).toHaveLength(0);
  });

  it("denies via provider_mismatch when the assistant→adapter map doesn't authorize this adapter", async () => {
    const h = await buildHarness({
      adapters: [acmeAdapter],
      assistantAdapterSlugs: new Map(), // nothing is authorized
    });
    h.agents.add(TOKEN, {
      id: AGENT_ID,
      status: "active",
      maxBudgetCents: 100,
      providerSlug: "acme-assistant",
    });

    const res = await h.app.inject({
      method: "POST",
      url: "/acme/widgets/create",
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: {},
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({
      error: "provider_mismatch",
      providerSlug: "acme",
      assistantSlug: "acme-assistant",
    });
    expect(h.upstream.calls).toHaveLength(0);
  });
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { registerInternalConnectorRoutes } from "../src/routes/internal-connectors.js";
import { FakeVault, MockUpstream } from "./helpers.js";

const SECRET = "test-internal-secret";
const ORIGINAL_SECRET = process.env.INTERNAL_CONNECTOR_SECRET;

async function buildApp(vault = new FakeVault({ secrets: { adminApiKey: "sk-ant-admin01-test" }, config: {} })) {
  const upstream = new MockUpstream();
  const app: FastifyInstance = Fastify();
  registerInternalConnectorRoutes(app, { vault, fetchImpl: upstream.fetchImpl });
  await app.ready();
  return { app, vault, upstream };
}

describe("POST /internal/connectors/anthropic-usage", () => {
  beforeEach(() => {
    process.env.INTERNAL_CONNECTOR_SECRET = SECRET;
  });
  afterEach(() => {
    if (ORIGINAL_SECRET === undefined) delete process.env.INTERNAL_CONNECTOR_SECRET;
    else process.env.INTERNAL_CONNECTOR_SECRET = ORIGINAL_SECRET;
  });

  it("rejects a request with no internal-secret header", async () => {
    const { app } = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/connectors/anthropic-usage",
      payload: { orgId: "org-1", upstreamKeyId: "key-1", startingAt: "a", endingAt: "b", apiKeyIds: ["k"] },
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects a request with the wrong secret", async () => {
    const { app } = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/connectors/anthropic-usage",
      headers: { "x-internal-secret": "wrong" },
      payload: { orgId: "org-1", upstreamKeyId: "key-1", startingAt: "a", endingAt: "b", apiKeyIds: ["k"] },
    });
    expect(res.statusCode).toBe(401);
  });

  it("401s when INTERNAL_CONNECTOR_SECRET isn't configured at all, even with a matching-looking header", async () => {
    delete process.env.INTERNAL_CONNECTOR_SECRET;
    const { app } = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/connectors/anthropic-usage",
      headers: { "x-internal-secret": "" },
      payload: { orgId: "org-1", upstreamKeyId: "key-1", startingAt: "a", endingAt: "b", apiKeyIds: ["k"] },
    });
    expect(res.statusCode).toBe(401);
  });

  it("400s on a malformed body, authorized or not", async () => {
    const { app } = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/connectors/anthropic-usage",
      headers: { "x-internal-secret": SECRET },
      payload: { orgId: "org-1" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("502s when the vault can't resolve the credential, and never calls upstream", async () => {
    const { app, upstream } = await buildApp(new FakeVault(null));
    const res = await app.inject({
      method: "POST",
      url: "/internal/connectors/anthropic-usage",
      headers: { "x-internal-secret": SECRET },
      payload: { orgId: "org-1", upstreamKeyId: "key-1", startingAt: "a", endingAt: "b", apiKeyIds: ["k"] },
    });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: "credential_unavailable" });
    expect(upstream.calls).toHaveLength(0);
  });

  it("decrypts via the vault (never returning the raw secret to the caller) and forwards to Anthropic's real usage endpoint", async () => {
    const { app, vault, upstream } = await buildApp();
    upstream.setResponder(
      () => new Response(JSON.stringify({ data: [{ starting_at: "a" }] }), { status: 200 }),
    );

    const res = await app.inject({
      method: "POST",
      url: "/internal/connectors/anthropic-usage",
      headers: { "x-internal-secret": SECRET },
      payload: {
        orgId: "org-1",
        upstreamKeyId: "key-1",
        startingAt: "2026-01-01T00:00:00Z",
        endingAt: "2026-01-01T01:00:00Z",
        apiKeyIds: ["apikey_abc", "apikey_def"],
        bucketWidth: "1m",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: [{ starting_at: "a" }] });

    // Vault looked up under the "anthropic-admin" slug specifically — the
    // whole point of reusing pgVault unchanged for this new credential type.
    expect(vault.lookups).toEqual([{ orgId: "org-1", slug: "anthropic-admin", keyId: "key-1" }]);

    const call = upstream.calls[0];
    expect(call?.url).toContain("https://api.anthropic.com/v1/organizations/usage_report/messages");
    expect(call?.url).toContain("starting_at=2026-01-01T00%3A00%3A00Z");
    expect(call?.url).toContain("bucket_width=1m");
    expect(call?.url).toContain("api_key_ids%5B%5D=apikey_abc");
    expect(call?.url).toContain("api_key_ids%5B%5D=apikey_def");
    // Without these, Anthropic's own report returns model/api_key_id as
    // null on every result — the poller can't price what it can't attribute.
    expect(call?.url).toContain("group_by%5B%5D=model");
    expect(call?.url).toContain("group_by%5B%5D=api_key_id");

    const headers = call?.init?.headers as Record<string, string>;
    // The decrypted admin key reaches the real Anthropic call — but never
    // appears anywhere in this route's own response above.
    expect(headers["x-api-key"]).toBe("sk-ant-admin01-test");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
  });

  it("forwards limit and page when the caller supplies them, for a poll window over Anthropic's default 60-bucket limit", async () => {
    const { app, upstream } = await buildApp();
    upstream.setResponder(() => new Response(JSON.stringify({ data: [] }), { status: 200 }));

    await app.inject({
      method: "POST",
      url: "/internal/connectors/anthropic-usage",
      headers: { "x-internal-secret": SECRET },
      payload: {
        orgId: "org-1",
        upstreamKeyId: "key-1",
        startingAt: "2026-01-01T00:00:00Z",
        endingAt: "2026-01-02T00:00:00Z",
        apiKeyIds: ["apikey_abc"],
        limit: 1440,
        page: "page_MjAyNS0wNS0xNFQwMDowMDowMFo=",
      },
    });

    const call = upstream.calls[0];
    expect(call?.url).toContain("limit=1440");
    expect(call?.url).toContain("page=page_MjAyNS0wNS0xNFQwMDowMDowMFo%3D");
  });
});

describe("POST /internal/connectors/anthropic-session-budget", () => {
  beforeEach(() => {
    process.env.INTERNAL_CONNECTOR_SECRET = SECRET;
  });
  afterEach(() => {
    if (ORIGINAL_SECRET === undefined) delete process.env.INTERNAL_CONNECTOR_SECRET;
    else process.env.INTERNAL_CONNECTOR_SECRET = ORIGINAL_SECRET;
  });

  const validPayload = {
    orgId: "org-1",
    upstreamKeyId: "key-1",
    sessionId: "sess_abc123",
    maxCostCents: 2500,
  };

  it("rejects a request with no internal-secret header", async () => {
    const { app } = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/connectors/anthropic-session-budget",
      payload: validPayload,
    });
    expect(res.statusCode).toBe(401);
  });

  it("400s on a malformed body", async () => {
    const { app } = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/connectors/anthropic-session-budget",
      headers: { "x-internal-secret": SECRET },
      payload: { orgId: "org-1" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("400s a zero or negative maxCostCents — Anthropic requires a positive whole-cent amount", async () => {
    const { app } = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/connectors/anthropic-session-budget",
      headers: { "x-internal-secret": SECRET },
      payload: { ...validPayload, maxCostCents: 0 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("400s a non-integer maxCostCents", async () => {
    const { app } = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/connectors/anthropic-session-budget",
      headers: { "x-internal-secret": SECRET },
      payload: { ...validPayload, maxCostCents: 25.5 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("502s when the vault can't resolve the credential, and never calls upstream", async () => {
    const { app, upstream } = await buildApp(new FakeVault(null));
    const res = await app.inject({
      method: "POST",
      url: "/internal/connectors/anthropic-session-budget",
      headers: { "x-internal-secret": SECRET },
      payload: validPayload,
    });
    expect(res.statusCode).toBe(502);
    expect(upstream.calls).toHaveLength(0);
  });

  it("decrypts via the vault and calls Anthropic's real session-update endpoint with the correct body shape", async () => {
    const { app, vault, upstream } = await buildApp();
    upstream.setResponder(
      () =>
        new Response(
          JSON.stringify({ id: "sess_abc123", budget: { type: "limit", max_list_cost: { amount: "2500", currency: "USD" } } }),
          { status: 200 },
        ),
    );

    const res = await app.inject({
      method: "POST",
      url: "/internal/connectors/anthropic-session-budget",
      headers: { "x-internal-secret": SECRET },
      payload: validPayload,
    });

    expect(res.statusCode).toBe(200);
    expect(vault.lookups).toEqual([{ orgId: "org-1", slug: "anthropic-admin", keyId: "key-1" }]);

    const call = upstream.calls[0];
    expect(call?.url).toBe("https://api.anthropic.com/v1/sessions/sess_abc123");
    expect(call?.init?.method).toBe("POST");

    const headers = call?.init?.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-ant-admin01-test");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    expect(headers["anthropic-beta"]).toBe("managed-agents-2026-04-01");

    // amount is a STRING of whole cents, never a JSON number — Anthropic
    // rejects float forms like "25.00" and this is the one place a bug here
    // would silently produce the wrong type.
    const body = JSON.parse(call?.init?.body as string);
    expect(body).toEqual({
      budget: { type: "limit", max_list_cost: { amount: "2500", currency: "USD" } },
    });
  });

  it("passes through Anthropic's real 400 when the new cap isn't above the session's consumed spend", async () => {
    const { app, upstream } = await buildApp();
    upstream.setResponder(
      () =>
        new Response(
          JSON.stringify({ error: { message: "budget.max_list_cost must be greater than the session's consumed list cost" } }),
          { status: 400 },
        ),
    );

    const res = await app.inject({
      method: "POST",
      url: "/internal/connectors/anthropic-session-budget",
      headers: { "x-internal-secret": SECRET },
      payload: validPayload,
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: { message: "budget.max_list_cost must be greater than the session's consumed list cost" },
    });
  });
});

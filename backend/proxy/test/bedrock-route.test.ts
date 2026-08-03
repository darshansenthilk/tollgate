import { describe, it, expect } from "vitest";
import { bedrockAdapter, normalizeBedrockModelId } from "../src/adapters/bedrock.js";
import { spendKey, currentMonth, MICROCENTS_PER_CENT } from "../src/lib/budget.js";
import { buildHarness, FIXED_NOW, FakeVault } from "./helpers.js";

const AGENT_ID = "agent-1";
const TOKEN = "tollgate-secret-token";
const MONTH = currentMonth(FIXED_NOW);
const KEY = spendKey(AGENT_ID, MONTH);

const BEDROCK_CREDENTIAL = {
  secrets: { accessKeyId: "AKIAEXAMPLE1234", secretAccessKey: "s3cr3t-access-key" },
  config: { region: "us-east-1" },
};

const MODEL_PATH = "/bedrock/model/anthropic.claude-3-5-sonnet-20241022-v2:0/invoke";

/** Bedrock's Claude response — field-for-field the same as Anthropic's own
 *  Messages API (verified against AWS's docs; see bedrock.ts's doc comment). */
function response(model: string, inputTokens: number, outputTokens: number) {
  return {
    id: "msg_bdrk_abc",
    type: "message",
    role: "assistant",
    model,
    content: [{ type: "text", text: "hi" }],
    stop_reason: "end_turn",
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  };
}

describe("normalizeBedrockModelId", () => {
  it("strips a trailing :N revision", () => {
    expect(normalizeBedrockModelId("anthropic.claude-3-opus-20240229-v1:0")).toBe(
      "anthropic.claude-3-opus-20240229-v1",
    );
  });

  it("strips a region-inference-profile prefix", () => {
    expect(normalizeBedrockModelId("us.anthropic.claude-3-5-sonnet-20240620-v1:0")).toBe(
      "anthropic.claude-3-5-sonnet-20240620-v1",
    );
  });

  it("leaves a plain model id (no profile, no revision) alone", () => {
    expect(normalizeBedrockModelId("anthropic.claude-3-haiku-20240307")).toBe(
      "anthropic.claude-3-haiku-20240307",
    );
  });
});

describe("POST /bedrock/* hot path", () => {
  it("signs with SigV4, using 'bedrock' as the signing service (not 'bedrock-runtime')", async () => {
    const h = await buildHarness({
      adapters: [bedrockAdapter],
      vault: new FakeVault(BEDROCK_CREDENTIAL),
    });
    h.agents.add(TOKEN, {
      id: AGENT_ID,
      status: "active",
      maxBudgetCents: 100,
      providerSlug: "bedrock",
    });

    const body = response("anthropic.claude-3-5-sonnet-20241022-v2:0", 1000, 500);
    h.upstream.setResponder(
      () =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );

    const res = await h.app.inject({
      method: "POST",
      url: MODEL_PATH,
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { max_tokens: 1024, messages: [{ role: "user", content: "hi" }] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(body);

    const call = h.upstream.calls[0];
    // Host is per-org (from credential.config.region), path mirrors Bedrock's
    // real InvokeModel path 1:1 under the provider slug.
    expect(call?.url).toBe(
      "https://bedrock-runtime.us-east-1.amazonaws.com/model/anthropic.claude-3-5-sonnet-20241022-v2:0/invoke",
    );

    const headers = call?.init?.headers as Record<string, string>;
    // The single highest-risk fact in this whole adapter: signed with
    // "bedrock", not "bedrock-runtime" — confirmed against botocore's own
    // service model (signingName vs. endpointPrefix). Getting this wrong
    // produces a SignatureDoesNotMatch that gives no hint why.
    expect(headers["authorization"]).toContain("/us-east-1/bedrock/aws4_request");
    expect(headers["authorization"]).toContain("AKIAEXAMPLE1234");
    expect(headers["authorization"]).toMatch(/^AWS4-HMAC-SHA256 /);
    expect(headers["x-amz-date"]).toBeDefined();
    // No session token was supplied (long-lived IAM user), so none should
    // appear — sending an empty one would itself be a signed-but-wrong header.
    expect(headers["x-amz-security-token"]).toBeUndefined();

    // The client's own body carried no anthropic_version — prepareRequestBody
    // must have injected it, or Bedrock would reject the request outright.
    const sentBody = JSON.parse(call?.init?.body as string) as Record<string, unknown>;
    expect(sentBody["anthropic_version"]).toBe("bedrock-2023-05-31");

    // cost = 1000 * 300/1e6 + 500 * 1500/1e6 = 1.05 cents.
    expect(h.budget.counters.get(KEY)).toBe(Math.round(1.05 * MICROCENTS_PER_CENT));
    expect(h.spendLog.events[0]).toMatchObject({
      agentId: AGENT_ID,
      providerId: "bedrock",
      actualCostCents: 1.05,
      decision: "allowed",
    });
  });

  it("includes x-amz-security-token when the org supplied temporary (STS) credentials", async () => {
    const h = await buildHarness({
      adapters: [bedrockAdapter],
      vault: new FakeVault({
        secrets: { ...BEDROCK_CREDENTIAL.secrets, sessionToken: "sts-session-token" },
        config: BEDROCK_CREDENTIAL.config,
      }),
    });
    h.agents.add(TOKEN, {
      id: AGENT_ID,
      status: "active",
      maxBudgetCents: 100,
      providerSlug: "bedrock",
    });
    h.upstream.setResponder(
      () => new Response(JSON.stringify(response("anthropic.claude-3-5-sonnet-20241022-v2:0", 10, 10)), { status: 200 }),
    );

    await h.app.inject({
      method: "POST",
      url: MODEL_PATH,
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: {},
    });

    const headers = h.upstream.calls[0]?.init?.headers as Record<string, string>;
    expect(headers["x-amz-security-token"]).toBe("sts-session-token");
  });

  it("prices a dated release via family + version normalization", async () => {
    const h = await buildHarness({
      adapters: [bedrockAdapter],
      vault: new FakeVault(BEDROCK_CREDENTIAL),
    });
    h.agents.add(TOKEN, {
      id: AGENT_ID,
      status: "active",
      maxBudgetCents: 100,
      providerSlug: "bedrock",
    });
    // A region-prefixed inference-profile id — normalizeBedrockModelId must
    // strip both the "us." prefix and the ":0" revision to find its family.
    h.upstream.setResponder(
      () =>
        new Response(
          JSON.stringify(response("us.anthropic.claude-3-5-haiku-20241022-v1:0", 2000, 1000)),
          { status: 200 },
        ),
    );

    await h.app.inject({
      method: "POST",
      url: "/bedrock/model/us.anthropic.claude-3-5-haiku-20241022-v1:0/invoke",
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: {},
    });

    // cost = 2000 * 80/1e6 + 1000 * 400/1e6 = 0.56 cents.
    expect(h.budget.counters.get(KEY)).toBe(Math.round(0.56 * MICROCENTS_PER_CENT));
  });

  it("returns cost 0 for an unrecognized model instead of crashing metering", async () => {
    const h = await buildHarness({
      adapters: [bedrockAdapter],
      vault: new FakeVault(BEDROCK_CREDENTIAL),
    });
    h.agents.add(TOKEN, {
      id: AGENT_ID,
      status: "active",
      maxBudgetCents: 100,
      providerSlug: "bedrock",
    });
    h.upstream.setResponder(
      () => new Response(JSON.stringify(response("anthropic.claude-9-future-v1:0", 1000, 1000)), { status: 200 }),
    );

    const res = await h.app.inject({
      method: "POST",
      url: "/bedrock/model/anthropic.claude-9-future-v1:0/invoke",
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    expect(h.budget.counters.get(KEY)).toBe(0);
    expect(h.spendLog.events[0]).toMatchObject({
      actualCostCents: 0,
      promptTokens: 1000,
      completionTokens: 1000,
    });
  });

  it("denies with upstream_credential_incomplete when the region is missing", async () => {
    const h = await buildHarness({
      adapters: [bedrockAdapter],
      vault: new FakeVault({ secrets: BEDROCK_CREDENTIAL.secrets, config: {} }),
    });
    h.agents.add(TOKEN, {
      id: AGENT_ID,
      status: "active",
      maxBudgetCents: 100,
      providerSlug: "bedrock",
    });

    const res = await h.app.inject({
      method: "POST",
      url: MODEL_PATH,
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: {},
    });

    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ error: "upstream_credential_incomplete" });
    // The critical assertion: nothing was signed or sent with an empty region.
    expect(h.upstream.calls).toHaveLength(0);
  });

  it("denies with upstream_credential_incomplete when the secret access key is missing", async () => {
    const h = await buildHarness({
      adapters: [bedrockAdapter],
      vault: new FakeVault({
        secrets: { accessKeyId: "AKIAEXAMPLE1234" },
        config: { region: "us-east-1" },
      }),
    });
    h.agents.add(TOKEN, {
      id: AGENT_ID,
      status: "active",
      maxBudgetCents: 100,
      providerSlug: "bedrock",
    });

    const res = await h.app.inject({
      method: "POST",
      url: MODEL_PATH,
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: {},
    });

    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ error: "upstream_credential_incomplete" });
    expect(h.upstream.calls).toHaveLength(0);
  });

  it("denies with provider_mismatch when the agent's assistant isn't bedrock", async () => {
    const h = await buildHarness({
      adapters: [bedrockAdapter],
      vault: new FakeVault(BEDROCK_CREDENTIAL),
    });
    h.agents.add(TOKEN, {
      id: AGENT_ID,
      status: "active",
      maxBudgetCents: 100,
      providerSlug: "claude", // created for Anthropic direct, not Bedrock
    });

    const res = await h.app.inject({
      method: "POST",
      url: MODEL_PATH,
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: {},
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({
      error: "provider_mismatch",
      providerSlug: "bedrock",
      assistantSlug: "claude",
    });
    expect(h.upstream.calls).toHaveLength(0);
  });
});

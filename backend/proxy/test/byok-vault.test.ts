import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createCipheriv, randomBytes } from "node:crypto";
import { openaiAdapter } from "../src/adapters/openai.js";
import { pgVault, envVault } from "../src/lib/vault.js";
import { decryptUpstreamKey } from "../src/lib/upstream-key-crypto.js";
import { buildHarness, FakeOrgVault, DEFAULT_TEST_ORG_ID } from "./helpers.js";

const TOKEN = "tg_byok_test_token";
const AGENT_ID = "11111111-1111-4111-8111-111111111111";
const KEY_B64 = randomBytes(32).toString("base64");

/**
 * Mirrors backend/api/src/lib/upstream-key-crypto.ts's encrypt exactly — the
 * api is the only thing that encrypts in production, so this test-local copy is
 * what lets us prove the proxy's decrypt actually interoperates with it rather
 * than only with itself.
 */
function encryptLikeApi(plaintext: string, keyB64: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(keyB64, "base64"), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    encrypted_key: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    auth_tag: cipher.getAuthTag().toString("base64"),
  };
}

/** Minimal pg.Pool stand-in: only `query` is ever called by pgVault. */
function fakePool(rows: Record<string, string>[]) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const pool = {
    query: async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      return { rows };
    },
  };
  return { pool: pool as never, calls };
}

describe("BYOK key resolution", () => {
  const originalVaultKey = process.env.VAULT_ENCRYPTION_KEY;
  const originalOpenAIKey = process.env.OPENAI_UPSTREAM_KEY;

  beforeEach(() => {
    process.env.VAULT_ENCRYPTION_KEY = KEY_B64;
  });

  afterEach(() => {
    if (originalVaultKey === undefined) delete process.env.VAULT_ENCRYPTION_KEY;
    else process.env.VAULT_ENCRYPTION_KEY = originalVaultKey;
    if (originalOpenAIKey === undefined) delete process.env.OPENAI_UPSTREAM_KEY;
    else process.env.OPENAI_UPSTREAM_KEY = originalOpenAIKey;
  });

  it("decrypts a key the api encrypted (cross-service round trip)", () => {
    const stored = encryptLikeApi("sk-org-real-key", KEY_B64);
    expect(
      decryptUpstreamKey({
        ciphertext: stored.encrypted_key,
        iv: stored.iv,
        authTag: stored.auth_tag,
      }),
    ).toBe("sk-org-real-key");
  });

  it("uses the org's own stored key when one exists", async () => {
    const { pool, calls } = fakePool([encryptLikeApi("sk-org-byok", KEY_B64)]);
    const vault = pgVault(pool, { env: { OPENAI_UPSTREAM_KEY: "sk-tollgate-shared" } });

    expect(await vault.getUpstreamKey("org-acme", "openai")).toBe("sk-org-byok");
    // Scoped by BOTH org and provider — the isolation that makes this safe.
    expect(calls[0]?.params).toEqual(["org-acme", "openai"]);
  });

  it("falls back to Tollgate's env key when the org has none (BYOK is opt-in)", async () => {
    const { pool } = fakePool([]);
    const vault = pgVault(pool, { env: { OPENAI_UPSTREAM_KEY: "sk-tollgate-shared" } });

    expect(await vault.getUpstreamKey("org-no-byok", "openai")).toBe("sk-tollgate-shared");
  });

  it("returns null (no fallback) when a stored key can't be decrypted", async () => {
    // Encrypted under a DIFFERENT key — i.e. api and proxy disagree on
    // VAULT_ENCRYPTION_KEY, or the row was tampered with.
    const otherKey = randomBytes(32).toString("base64");
    const { pool } = fakePool([encryptLikeApi("sk-org-byok", otherKey)]);

    const failures: { orgId: string; slug: string }[] = [];
    const vault = pgVault(pool, {
      env: { OPENAI_UPSTREAM_KEY: "sk-tollgate-shared" },
      onDecryptFailure: (orgId, slug) => failures.push({ orgId, slug }),
    });

    // The critical assertion: it must NOT silently bill Tollgate's shared key
    // for an org that explicitly configured their own.
    expect(await vault.getUpstreamKey("org-acme", "openai")).toBeNull();
    expect(failures).toEqual([{ orgId: "org-acme", slug: "openai" }]);
  });

  it("envVault ignores org entirely (pre-BYOK behavior)", async () => {
    const vault = envVault({ OPENAI_UPSTREAM_KEY: "sk-env-only" } as NodeJS.ProcessEnv);
    expect(await vault.getUpstreamKey("org-a", "openai")).toBe("sk-env-only");
    expect(await vault.getUpstreamKey("org-b", "openai")).toBe("sk-env-only");
  });
});

describe("BYOK through the proxy hot path", () => {
  it("forwards upstream with the requesting agent's own org key", async () => {
    const vault = new FakeOrgVault("sk-tollgate-shared");
    vault.set(DEFAULT_TEST_ORG_ID, "openai", "sk-org-specific");

    const h = await buildHarness({ adapters: [openaiAdapter], vault });
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

    const sent = h.upstream.calls[0]?.init?.headers as Record<string, string>;
    expect(sent["authorization"]).toBe("Bearer sk-org-specific");
  });

  it("denies with 502 rather than forwarding when no key resolves", async () => {
    // Models the fail-closed case: vault returned null (undecryptable org key).
    const vault = new FakeOrgVault(null);

    const h = await buildHarness({ adapters: [openaiAdapter], vault });
    h.agents.add(TOKEN, {
      id: AGENT_ID,
      status: "active",
      maxBudgetCents: 1000,
      providerSlug: "chatgpt",
    });

    const res = await h.app.inject({
      method: "POST",
      url: "/openai/v1/chat/completions",
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { model: "gpt-4o-mini", messages: [] },
    });

    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: "upstream_key_unavailable" });
    // Nothing left the process — the request was never forwarded upstream.
    expect(h.upstream.calls).toHaveLength(0);
  });
});

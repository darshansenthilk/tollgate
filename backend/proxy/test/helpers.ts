import Fastify, { type FastifyInstance } from "fastify";
import type { ProviderAdapter, ToolDefinition, UpstreamCredential } from "@tollgate/shared";
import {
  buildRegistry,
  assistantAdapterSlugs as defaultAssistantAdapterSlugs,
  type ProviderRegistry,
} from "../src/adapters/registry.js";
import {
  hashToken,
  type AgentStore,
  type AuthedAgent,
} from "../src/lib/agents.js";
import type { BudgetStore } from "../src/lib/budget.js";
import type { SpendLog, SpendRecord } from "../src/lib/spend-log.js";
import type { Vault } from "../src/lib/vault.js";
import type { FreezeStore } from "../src/lib/freeze.js";
import type { TokenUsageStore } from "../src/lib/token-usage.js";
import type { CurrentPromptStore } from "../src/lib/current-prompt.js";
import type { ApprovalStore } from "../src/lib/tool-approvals.js";
import { registerProxyRoute, type ProxyDeps } from "../src/routes/proxy.js";

/** Org used for agents added without an explicit one. */
export const DEFAULT_TEST_ORG_ID = "org-test";

/** In-memory AgentStore keyed by raw token (hashed on insert, like production). */
export class FakeAgentStore implements AgentStore {
  private readonly byHash = new Map<string, AuthedAgent>();

  /** orgId, upstreamKeyId, blockedTools, systemPrompt and toolDefinitions are
   *  all optional and default to their "off" value, so the many tests that
   *  predate any of them stay unchanged while a test exercising one can
   *  still pin a specific value. */
  add(
    token: string,
    agent: Omit<
      AuthedAgent,
      "orgId" | "upstreamKeyId" | "blockedTools" | "systemPrompt" | "toolDefinitions"
    > & {
      orgId?: string;
      upstreamKeyId?: string | null;
      blockedTools?: string[] | null;
      systemPrompt?: string | null;
      toolDefinitions?: ToolDefinition[] | null;
    },
  ): void {
    this.byHash.set(hashToken(token), {
      ...agent,
      orgId: agent.orgId ?? DEFAULT_TEST_ORG_ID,
      upstreamKeyId: agent.upstreamKeyId ?? null,
      blockedTools: agent.blockedTools ?? null,
      systemPrompt: agent.systemPrompt ?? null,
      toolDefinitions: agent.toolDefinitions ?? null,
    });
  }

  async findByTokenHash(tokenHash: string): Promise<AuthedAgent | null> {
    return this.byHash.get(tokenHash) ?? null;
  }
}

/** In-memory BudgetStore mirroring Redis INCRBY semantics on integers. */
export class FakeBudgetStore implements BudgetStore {
  readonly counters = new Map<string, number>();

  seed(key: string, microCents: number): void {
    this.counters.set(key, microCents);
  }

  async getSpendMicroCents(key: string): Promise<number> {
    return this.counters.get(key) ?? 0;
  }

  async addSpendMicroCents(key: string, delta: number): Promise<number> {
    const next = (this.counters.get(key) ?? 0) + delta;
    this.counters.set(key, next);
    return next;
  }
}

/** In-memory SpendLog capturing recorded audit events. */
export class FakeSpendLog implements SpendLog {
  readonly events: SpendRecord[] = [];

  async record(event: SpendRecord): Promise<void> {
    this.events.push(event);
  }
}

/** Wraps a bare API key in the single-secret credential shape the
 *  OpenAI/Claude/Gemini adapters expect, so tests that don't care about
 *  structured credentials stay readable. */
export function apiKeyCredential(apiKey: string): UpstreamCredential {
  return { secrets: { apiKey }, config: {} };
}

/** Vault that hands out a fixed credential for any (org, slug), recording
 *  every lookup so a test can assert the hot path scoped by the right org.
 *  Accepts a bare string for the common single-key case. */
export class FakeVault implements Vault {
  readonly lookups: { orgId: string; slug: string; keyId: string | null }[] = [];
  private readonly credential: UpstreamCredential | null;

  constructor(key: string | UpstreamCredential | null) {
    this.credential = typeof key === "string" ? apiKeyCredential(key) : key;
  }

  async getUpstreamKey(
    orgId: string,
    slug: string,
    keyId: string | null,
  ): Promise<UpstreamCredential | null> {
    this.lookups.push({ orgId, slug, keyId });
    return this.credential;
  }
}

/** Vault with per-org credentials, for exercising BYOK resolution end to end.
 *  Ignores keyId deliberately — this fake proves the proxy forwards with
 *  whatever the vault resolves, not the resolution logic itself (that's
 *  pgVault's job, covered directly in byok-vault.test.ts). */
export class FakeOrgVault implements Vault {
  /** Keyed "orgId:slug". */
  private readonly keys = new Map<string, UpstreamCredential>();
  private readonly fallback: UpstreamCredential | null;

  constructor(fallback: string | UpstreamCredential | null = null) {
    this.fallback = typeof fallback === "string" ? apiKeyCredential(fallback) : fallback;
  }

  set(orgId: string, slug: string, key: string | UpstreamCredential): void {
    this.keys.set(`${orgId}:${slug}`, typeof key === "string" ? apiKeyCredential(key) : key);
  }

  async getUpstreamKey(
    orgId: string,
    slug: string,
    _keyId: string | null,
  ): Promise<UpstreamCredential | null> {
    return this.keys.get(`${orgId}:${slug}`) ?? this.fallback;
  }
}

/** In-memory FreezeStore. Defaults to "nobody frozen" unless seeded. */
export class FakeFreezeStore implements FreezeStore {
  private readonly frozen = new Set<string>();

  freeze(agentId: string): void {
    this.frozen.add(agentId);
  }

  unfreeze(agentId: string): void {
    this.frozen.delete(agentId);
  }

  async isFrozen(agentId: string): Promise<boolean> {
    return this.frozen.has(agentId);
  }
}

/** In-memory TokenUsageStore mirroring Redis INCRBY semantics on integers. */
export class FakeTokenUsageStore implements TokenUsageStore {
  readonly counters = new Map<string, number>();

  async addTokens(key: string, delta: number): Promise<number> {
    const next = (this.counters.get(key) ?? 0) + delta;
    this.counters.set(key, next);
    return next;
  }
}

/** In-memory CurrentPromptStore. Records the latest write per agent (no TTL
 *  simulation needed — tests assert on the write itself, not its expiry). */
export class FakeCurrentPromptStore implements CurrentPromptStore {
  readonly prompts = new Map<string, string>();

  async setCurrentPrompt(agentId: string, prompt: string): Promise<void> {
    this.prompts.set(agentId, prompt);
  }
}

/** In-memory ApprovalStore. Grants are single-use, mirroring the real store's
 *  atomic DEL semantics; raised requests are recorded so a test can assert the
 *  escalation was queued rather than silently dropped. */
export class FakeApprovalStore implements ApprovalStore {
  readonly requests: { orgId: string; agentId: string; toolName: string }[] = [];
  private readonly grants = new Set<string>();

  grant(agentId: string, toolName: string): void {
    this.grants.add(`${agentId}:${toolName}`);
  }

  async consumeGrant(agentId: string, toolName: string): Promise<boolean> {
    return this.grants.delete(`${agentId}:${toolName}`);
  }

  async requestApproval(args: {
    orgId: string;
    agentId: string;
    toolName: string;
  }): Promise<void> {
    // Mirrors the real store's ON CONFLICT DO NOTHING against one pending row
    // per (agent, tool) — a retry loop must not pile up duplicates.
    const exists = this.requests.some(
      (r) => r.agentId === args.agentId && r.toolName === args.toolName,
    );
    if (!exists) this.requests.push(args);
  }
}

export interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

/**
 * Mock upstream: records every call and returns the queued response. Proves the
 * route never really left the process while still exercising fetch/text/status.
 */
export class MockUpstream {
  readonly calls: FetchCall[] = [];

  constructor(
    private responder: (call: FetchCall) => Response = () =>
      new Response("{}", { status: 200 }),
  ) {}

  setResponder(fn: (call: FetchCall) => Response): void {
    this.responder = fn;
  }

  get fetchImpl(): typeof fetch {
    return (async (input: RequestInfo | URL, init?: RequestInit) => {
      const call: FetchCall = { url: String(input), init };
      this.calls.push(call);
      return this.responder(call);
    }) as typeof fetch;
  }
}

export interface HarnessOverrides {
  adapters?: readonly ProviderAdapter[];
  registry?: ProviderRegistry;
  agents?: AgentStore;
  budget?: BudgetStore;
  spendLog?: SpendLog;
  vault?: Vault;
  freeze?: FreezeStore;
  tokenUsage?: TokenUsageStore;
  currentPrompt?: CurrentPromptStore;
  approvals?: ApprovalStore;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  assistantAdapterSlugs?: ReadonlyMap<string, string>;
}

export interface Harness {
  app: FastifyInstance;
  deps: ProxyDeps;
  agents: FakeAgentStore;
  budget: FakeBudgetStore;
  spendLog: FakeSpendLog;
  freeze: FakeFreezeStore;
  tokenUsage: FakeTokenUsageStore;
  currentPrompt: FakeCurrentPromptStore;
  approvals: FakeApprovalStore;
  upstream: MockUpstream;
}

/** Frozen clock so month-keyed Redis keys are deterministic in assertions. */
export const FIXED_NOW = new Date("2026-07-07T12:00:00.000Z");

/**
 * Build a Fastify app with the real proxy route registered against injectable
 * fakes. Callers can override any dependency — including the whole registry, so
 * a test can drive the exact same handler with a non-OpenAI adapter.
 */
export async function buildHarness(
  overrides: HarnessOverrides = {},
): Promise<Harness> {
  const agents =
    overrides.agents instanceof FakeAgentStore
      ? overrides.agents
      : new FakeAgentStore();
  const budget =
    overrides.budget instanceof FakeBudgetStore
      ? overrides.budget
      : new FakeBudgetStore();
  const spendLog =
    overrides.spendLog instanceof FakeSpendLog
      ? overrides.spendLog
      : new FakeSpendLog();
  const freeze =
    overrides.freeze instanceof FakeFreezeStore
      ? overrides.freeze
      : new FakeFreezeStore();
  const tokenUsage =
    overrides.tokenUsage instanceof FakeTokenUsageStore
      ? overrides.tokenUsage
      : new FakeTokenUsageStore();
  const currentPrompt =
    overrides.currentPrompt instanceof FakeCurrentPromptStore
      ? overrides.currentPrompt
      : new FakeCurrentPromptStore();
  const approvals =
    overrides.approvals instanceof FakeApprovalStore
      ? overrides.approvals
      : new FakeApprovalStore();
  const upstream = new MockUpstream();

  const deps: ProxyDeps = {
    registry: overrides.registry ?? buildRegistry(overrides.adapters ?? []),
    agents: overrides.agents ?? agents,
    budget: overrides.budget ?? budget,
    spendLog: overrides.spendLog ?? spendLog,
    vault: overrides.vault ?? new FakeVault("sk-upstream-test"),
    freeze: overrides.freeze ?? freeze,
    tokenUsage: overrides.tokenUsage ?? tokenUsage,
    currentPrompt: overrides.currentPrompt ?? currentPrompt,
    approvals: overrides.approvals ?? approvals,
    fetchImpl: overrides.fetchImpl ?? upstream.fetchImpl,
    now: overrides.now ?? (() => FIXED_NOW),
    assistantAdapterSlugs: overrides.assistantAdapterSlugs ?? defaultAssistantAdapterSlugs,
  };

  const app = Fastify();
  registerProxyRoute(app, deps);
  await app.ready();

  return {
    app,
    deps,
    agents,
    budget,
    spendLog,
    freeze,
    tokenUsage,
    currentPrompt,
    approvals,
    upstream,
  };
}

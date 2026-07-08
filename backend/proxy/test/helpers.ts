import Fastify, { type FastifyInstance } from "fastify";
import type { ProviderAdapter } from "@tollgate/shared";
import { buildRegistry, type ProviderRegistry } from "../src/adapters/registry.js";
import {
  hashToken,
  type AgentStore,
  type AuthedAgent,
} from "../src/lib/agents.js";
import type { BudgetStore } from "../src/lib/budget.js";
import type { SpendLog, SpendRecord } from "../src/lib/spend-log.js";
import type { Vault } from "../src/lib/vault.js";
import type { FreezeStore } from "../src/lib/freeze.js";
import { registerProxyRoute, type ProxyDeps } from "../src/routes/proxy.js";

/** In-memory AgentStore keyed by raw token (hashed on insert, like production). */
export class FakeAgentStore implements AgentStore {
  private readonly byHash = new Map<string, AuthedAgent>();

  add(token: string, agent: AuthedAgent): void {
    this.byHash.set(hashToken(token), agent);
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

/** Vault that hands out a fixed key for any slug. */
export class FakeVault implements Vault {
  constructor(private readonly key: string | null) {}
  getUpstreamKey(): string | null {
    return this.key;
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
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

export interface Harness {
  app: FastifyInstance;
  deps: ProxyDeps;
  agents: FakeAgentStore;
  budget: FakeBudgetStore;
  spendLog: FakeSpendLog;
  freeze: FakeFreezeStore;
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
  const upstream = new MockUpstream();

  const deps: ProxyDeps = {
    registry: overrides.registry ?? buildRegistry(overrides.adapters ?? []),
    agents: overrides.agents ?? agents,
    budget: overrides.budget ?? budget,
    spendLog: overrides.spendLog ?? spendLog,
    vault: overrides.vault ?? new FakeVault("sk-upstream-test"),
    freeze: overrides.freeze ?? freeze,
    fetchImpl: overrides.fetchImpl ?? upstream.fetchImpl,
    now: overrides.now ?? (() => FIXED_NOW),
  };

  const app = Fastify();
  registerProxyRoute(app, deps);
  await app.ready();

  return { app, deps, agents, budget, spendLog, freeze, upstream };
}

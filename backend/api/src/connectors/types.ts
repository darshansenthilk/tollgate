import type { anthropicManagedAgentLinks } from "../db/schema.js";

/** Drizzle's inferred row type — schema.ts doesn't export one of its own, so
 *  this is the standard `$inferSelect` idiom rather than hand-duplicating the
 *  column list. */
export type AnthropicManagedAgentLink = typeof anthropicManagedAgentLinks.$inferSelect;

/**
 * Real, priced usage for one time bucket a platform connector's pollUsage()
 * reports back — the pull-based counterpart to ProviderCost, which the proxy
 * adapters report per-request on the forward path. costCents is null when the
 * model has no known list price (see @tollgate/shared's findModelPrice doc
 * comment) — the poller still records the token counts rather than treating
 * unpriced usage as free or invisible.
 */
export interface UsageBucket {
  startingAt: Date;
  endingAt: Date;
  /** Null when the platform's report didn't (or couldn't) attribute this
   *  bucket to a specific model. */
  model: string | null;
  promptTokens: number;
  completionTokens: number;
  costCents: number | null;
}

/**
 * The pull-based counterpart to ProviderAdapter (@tollgate/shared): where an
 * adapter forwards live traffic through the proxy's hot path, a
 * PlatformConnector instead polls a platform Tollgate can't intercept traffic
 * for, and turns its own usage/cost reporting into the same real spend_events
 * rows a proxied agent's traffic would produce.
 *
 * Typed directly against AnthropicManagedAgentLink rather than a generic
 * `<TLink>` — a second connector (Salesforce Agentforce, Phase 3) doesn't
 * exist yet, and its link row's real shape isn't confirmed, so generalizing
 * this interface ahead of that second implementation would be exactly the
 * kind of speculative abstraction this codebase avoids elsewhere. Revisit
 * when Phase 3 actually needs it.
 */
export interface PlatformConnector {
  slug: string;
  label: string;

  /** Real usage for [since, now) — never an estimate. Throws on a genuine
   *  failure to reach or authenticate against the platform; callers (the
   *  poller script) decide how to log/retry that. */
  pollUsage(args: {
    link: AnthropicManagedAgentLink;
    since: Date;
    now: Date;
  }): Promise<UsageBucket[]>;

  /**
   * Native budget delegation (Phase 4) — optional because only a platform
   * with its own real-time spend enforcement can implement it at all.
   *
   * Deliberately takes a required positive `maxCostCents`, never `null`:
   * Anthropic's own budget-removal is one-way (a session whose budget is
   * removed can never be given one again), so an automated poller must never
   * be able to trigger that irreversible action on the operator's behalf.
   * Narrowing or widening an existing cap is the only thing this ever does.
   */
  setBudget?(args: {
    link: AnthropicManagedAgentLink;
    maxCostCents: number;
  }): Promise<{ ok: true } | { ok: false; reason: string }>;

  /** Cheap, real check that a stored credential still authenticates —
   *  distinct from the save-time probe in upstream-key-verify.ts, which runs
   *  once against the plaintext value before it's ever encrypted. This one
   *  re-checks an already-stored (and possibly since-revoked) credential. */
  verifyCredential(args: { orgId: string; upstreamKeyId: string }): Promise<
    { ok: true } | { ok: false; reason: string }
  >;
}

import { describe, it, expect } from "vitest";
import {
  findModelPrice,
  CLAUDE_PRICES,
  GEMINI_PRICES,
  OPENAI_PRICES,
  type ModelPrice,
} from "@tollgate/shared";

/**
 * findModelPrice exists because providers ship a newly-dated model id every
 * few weeks, and every one that misses the price table meters at $0 — which
 * silently disables budget enforcement for any agent using it. These tests
 * pin both halves of the contract: dated releases resolve to their family,
 * and genuinely-different models never borrow another model's price.
 */

const PRICES: Record<string, ModelPrice> = {
  "gpt-4o": { inputCentsPerMTok: 250, outputCentsPerMTok: 1000 },
  "gpt-4o-mini": { inputCentsPerMTok: 15, outputCentsPerMTok: 60 },
};

describe("findModelPrice", () => {
  it("prefers an exact match", () => {
    expect(findModelPrice("gpt-4o-mini", PRICES)).toEqual(PRICES["gpt-4o-mini"]);
  });

  it("resolves a dated release to its family", () => {
    // The case that actually bites in production: OpenAI reports the dated id
    // in the response, not the family name the table is keyed by.
    expect(findModelPrice("gpt-4o-2024-08-06", PRICES)).toEqual(PRICES["gpt-4o"]);
    expect(findModelPrice("gpt-4o-mini-2024-07-18", PRICES)).toEqual(PRICES["gpt-4o-mini"]);
  });

  it("resolves vN and -latest suffixes", () => {
    expect(findModelPrice("gpt-4o-v2", PRICES)).toEqual(PRICES["gpt-4o"]);
    expect(findModelPrice("gpt-4o-latest", PRICES)).toEqual(PRICES["gpt-4o"]);
  });

  it("does NOT let an unknown variant borrow a pricier family's rate", () => {
    // The hazard this function is deliberately narrow to avoid: naive suffix
    // stripping would resolve "gpt-4o-nano" to "gpt-4o" and bill it ~16x its
    // real rate. Reporting $0 (and surfacing it) beats confidently overbilling.
    expect(findModelPrice("gpt-4o-nano", PRICES)).toBeUndefined();
    expect(findModelPrice("gpt-4o-preview", PRICES)).toBeUndefined();
  });

  it("returns undefined for a model with no family in the table", () => {
    expect(findModelPrice("some-future-model-2027-01-01", PRICES)).toBeUndefined();
  });

  it("never strips the whole name away", () => {
    expect(findModelPrice("2024", PRICES)).toBeUndefined();
  });

  it("prices the real dated ids each provider actually returns", () => {
    // Anthropic and Gemini both report dated/pinned ids on every response;
    // these are the exact spellings their APIs send back.
    expect(findModelPrice("claude-3-5-sonnet-20241022", CLAUDE_PRICES)).toEqual(
      CLAUDE_PRICES["claude-3-5-sonnet"],
    );
    expect(findModelPrice("claude-3-5-haiku-20241022", CLAUDE_PRICES)).toEqual(
      CLAUDE_PRICES["claude-3-5-haiku"],
    );
    expect(findModelPrice("gemini-1.5-flash-001", GEMINI_PRICES)).toEqual(
      GEMINI_PRICES["gemini-1.5-flash"],
    );
    expect(findModelPrice("gpt-4o-2024-11-20", OPENAI_PRICES)).toEqual(
      OPENAI_PRICES["gpt-4o"],
    );
  });

  it("keeps gemini-1.5-flash-8b distinct from gemini-1.5-flash", () => {
    // "8b" is not a release suffix — it's a genuinely cheaper model, and
    // collapsing it into the flash family would overbill it 2x.
    expect(findModelPrice("gemini-1.5-flash-8b", GEMINI_PRICES)).toEqual(
      GEMINI_PRICES["gemini-1.5-flash-8b"],
    );
    expect(findModelPrice("gemini-1.5-flash-8b", GEMINI_PRICES)).not.toEqual(
      GEMINI_PRICES["gemini-1.5-flash"],
    );
  });
});

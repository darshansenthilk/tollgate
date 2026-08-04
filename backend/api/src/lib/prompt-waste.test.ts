import { test } from "node:test";
import assert from "node:assert/strict";
import {
  detectRepeatedBlock,
  estimateTokens,
  estimateWasteCents,
  MIN_BLOCK_CHARS,
} from "./prompt-waste.js";

/** A realistic request body: a big static preamble, then the varying part. */
function body(preamble: string, question: string): string {
  return JSON.stringify({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: preamble },
      { role: "user", content: question },
    ],
  });
}

const CATALOG = "PRODUCT CATALOG: ".concat("sku-4471 widget $19.99; ".repeat(60));

test("finds a large preamble repeated across requests", () => {
  const prompts = [
    body(CATALOG, "where is order 1"),
    body(CATALOG, "where is order 2"),
    body(CATALOG, "refund order 3"),
    body(CATALOG, "cancel order 4"),
  ];
  const block = detectRepeatedBlock(prompts);
  assert.notEqual(block, null);
  assert.equal(block?.position, "prefix");
  assert.equal(block?.frequency, 1);
  assert.ok(block!.text.includes("PRODUCT CATALOG"));
  assert.ok(block!.text.length >= MIN_BLOCK_CHARS);
});

test("reports nothing when requests share only the request format", () => {
  // Same endpoint, same model, genuinely different content — the short shared
  // prefix here is the JSON envelope, which nobody can remove.
  const prompts = [
    body("You are helpful.", "where is order 1"),
    body("You are helpful.", "refund order 2"),
  ];
  assert.equal(detectRepeatedBlock(prompts), null);
});

test("still reports a block when a minority of requests don't share it", () => {
  // The one oddball must not hide what the other three are paying for — a
  // strict all-requests intersection would return nothing here.
  const prompts = [
    body(CATALOG, "a"),
    body(CATALOG, "b"),
    body(CATALOG, "c"),
    body("totally different preamble", "d"),
  ];
  const block = detectRepeatedBlock(prompts);
  assert.notEqual(block, null);
  assert.ok(block!.frequency >= 0.5 && block!.frequency < 1);
});

test("ignores a block shared by too few requests to matter", () => {
  const prompts = [
    body(CATALOG, "a"),
    body(CATALOG, "b"),
    ...Array.from({ length: 20 }, (_, i) => body(`unique preamble ${i}`, `q${i}`)),
  ];
  // 2 of 22 share it — below MIN_FREQUENCY, so not a finding.
  assert.equal(detectRepeatedBlock(prompts), null);
});

test("detects a repeated trailing block, not just a preamble", () => {
  const trailer = "ALWAYS respond in JSON. ".repeat(40);
  const prompts = [
    `ask about order 1. ${trailer}`,
    `ask about order 2. ${trailer}`,
    `ask about order 3. ${trailer}`,
  ];
  const block = detectRepeatedBlock(prompts);
  assert.equal(block?.position, "suffix");
  assert.ok(block!.text.includes("ALWAYS respond in JSON"));
});

test("needs at least two prompts, and tolerates empty input", () => {
  assert.equal(detectRepeatedBlock([]), null);
  assert.equal(detectRepeatedBlock([body(CATALOG, "only one")]), null);
  assert.equal(detectRepeatedBlock(["", ""]), null);
});

test("estimates cost, and admits when the model has no known price", () => {
  const block = { text: "x".repeat(4_000), frequency: 1, position: "prefix" as const };
  assert.equal(estimateTokens(block.text), 1_000);

  // 1,000 tokens * 100 requests * 15c/MTok = 1.5c
  assert.equal(estimateWasteCents(block, 100, 15), 1.5);

  // An unpriced model must not be reported as costing nothing.
  assert.equal(estimateWasteCents(block, 100, null), null);
});

test("scales the estimate by how often the block actually appears", () => {
  const block = { text: "x".repeat(4_000), frequency: 0.5, position: "prefix" as const };
  // Half the requests carry it, so half the cost.
  assert.equal(estimateWasteCents(block, 100, 15), 0.75);
});

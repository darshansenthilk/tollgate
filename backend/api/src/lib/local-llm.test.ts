import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDraft } from "./local-llm.js";

/**
 * parseDraft is the trust boundary between a small local model and a form the
 * operator is about to submit. Small models return malformed, half-typed and
 * over-eager output routinely, so every case here is one that has to degrade
 * to "no suggestion" rather than throw or pre-fill something wrong.
 */

test("reads a well-formed draft", () => {
  const draft = parseDraft({
    name: "refund-bot",
    systemPrompt: "You handle refunds under $100.",
    blockedTools: ["delete_customer", "send_payment"],
    maxBudgetCents: 5000,
  });
  assert.equal(draft.name, "refund-bot");
  assert.equal(draft.systemPrompt, "You handle refunds under $100.");
  assert.deepEqual(draft.blockedTools, ["delete_customer", "send_payment"]);
  assert.equal(draft.maxBudgetCents, 5000);
});

test("a non-object, null or garbage response yields an empty draft, not a throw", () => {
  for (const bad of [null, undefined, "sorry, I can't help with that", 42, []]) {
    const draft = parseDraft(bad);
    assert.equal(draft.name, null);
    assert.equal(draft.systemPrompt, null);
    assert.deepEqual(draft.blockedTools, []);
    assert.equal(draft.maxBudgetCents, null);
  }
});

test("drops tool names that are prose rather than identifiers", () => {
  // A model describing tools instead of naming them would otherwise produce a
  // blocklist that looks protective and matches nothing a provider emits.
  const draft = parseDraft({
    blockedTools: [
      "delete_customer",
      "anything that deletes records",
      "send payment",
      "tools.refund",
      "",
      "   ",
      123,
      null,
    ],
  });
  assert.deepEqual(draft.blockedTools, ["delete_customer", "tools.refund"]);
});

test("de-duplicates tool names and caps the list", () => {
  const draft = parseDraft({
    blockedTools: ["a_tool", "a_tool", "a_tool"],
  });
  assert.deepEqual(draft.blockedTools, ["a_tool"]);

  const many = parseDraft({
    blockedTools: Array.from({ length: 50 }, (_, i) => `tool_${i}`),
  });
  assert.equal(many.blockedTools.length, 20);
});

test("clamps a hallucinated budget instead of pre-filling something absurd", () => {
  assert.equal(parseDraft({ maxBudgetCents: 999_999_999_999 }).maxBudgetCents, 10_000_000);
  assert.equal(parseDraft({ maxBudgetCents: -5 }).maxBudgetCents, null);
  assert.equal(parseDraft({ maxBudgetCents: "not a number" }).maxBudgetCents, null);
  assert.equal(parseDraft({ maxBudgetCents: Number.NaN }).maxBudgetCents, null);
  assert.equal(parseDraft({ maxBudgetCents: Number.POSITIVE_INFINITY }).maxBudgetCents, null);
  // Models emit stringified numbers constantly; that one IS worth accepting.
  assert.equal(parseDraft({ maxBudgetCents: "2500" }).maxBudgetCents, 2500);
  assert.equal(parseDraft({ maxBudgetCents: 12.6 }).maxBudgetCents, 13);
});

test("truncates an overlong name and system prompt rather than rejecting them", () => {
  const draft = parseDraft({
    name: "x".repeat(200),
    systemPrompt: "y".repeat(5_000),
  });
  assert.equal(draft.name?.length, 60);
  assert.equal(draft.systemPrompt?.length, 2_000);
});

test("treats whitespace-only strings as absent", () => {
  const draft = parseDraft({ name: "   ", systemPrompt: "\n\t " });
  assert.equal(draft.name, null);
  assert.equal(draft.systemPrompt, null);
});

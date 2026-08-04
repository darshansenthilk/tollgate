import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAnswerText } from "./answer-text.js";

test("passes through a normal answer, drops empty/non-string ones", () => {
  assert.equal(
    parseAnswerText("A VAULT_ENCRYPTION_KEY encrypts stored keys."),
    "A VAULT_ENCRYPTION_KEY encrypts stored keys.",
  );
  assert.equal(parseAnswerText(""), null);
  assert.equal(parseAnswerText("   \n  "), null);
  assert.equal(parseAnswerText(null), null);
  assert.equal(parseAnswerText(undefined), null);
  assert.equal(parseAnswerText(42), null);
});

test("truncates a run-on answer as a second, independent bound on length", () => {
  const answer = parseAnswerText("x".repeat(5_000));
  assert.ok(answer !== null);
  assert.ok(answer.endsWith("…"));
  // 1,500 chars kept + the ellipsis marker.
  assert.equal(answer.length, 1_501);
});

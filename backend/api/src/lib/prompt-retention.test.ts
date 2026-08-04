import { test } from "node:test";
import assert from "node:assert/strict";
import { cutoffDate, resolveRetentionDays, DEFAULT_RETENTION_DAYS } from "./prompt-retention.js";

test("resolveRetentionDays: uses the default when unset", () => {
  assert.equal(resolveRetentionDays({}), DEFAULT_RETENTION_DAYS);
});

test("resolveRetentionDays: accepts a positive integer override", () => {
  assert.equal(resolveRetentionDays({ PROMPT_RETENTION_DAYS: "30" }), 30);
});

test("resolveRetentionDays: falls back to the default rather than retaining forever or crashing", () => {
  // 0 and negative would mean "never retain" / nonsensical — degrade to the
  // safe default instead of doing something surprising with customer data.
  for (const bad of ["0", "-5", "not a number", "", "NaN"]) {
    assert.equal(resolveRetentionDays({ PROMPT_RETENTION_DAYS: bad }), DEFAULT_RETENTION_DAYS);
  }
});

test("cutoffDate: subtracts the right number of days", () => {
  const now = new Date("2026-08-04T00:00:00.000Z");
  assert.equal(cutoffDate(90, now).toISOString(), "2026-05-06T00:00:00.000Z");
  assert.equal(cutoffDate(1, now).toISOString(), "2026-08-03T00:00:00.000Z");
  assert.equal(cutoffDate(0, now).toISOString(), now.toISOString());
});

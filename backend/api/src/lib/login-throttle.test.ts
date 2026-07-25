import { test } from "node:test";
import assert from "node:assert/strict";
import {
  lockoutDurationMin,
  nextLevel,
  humanizeDuration,
  CAP_MIN,
} from "./login-throttle.js";

test("lockout ladder doubles from 5m, capped at 24h", () => {
  assert.equal(lockoutDurationMin(0), 5);
  assert.equal(lockoutDurationMin(1), 10);
  assert.equal(lockoutDurationMin(2), 20);
  assert.equal(lockoutDurationMin(3), 40);
  assert.equal(lockoutDurationMin(4), 80);
  assert.equal(lockoutDurationMin(5), 160);
  assert.equal(lockoutDurationMin(8), 1280);
  // level 9 would be 2560 → clamped to the 24h cap (1440)
  assert.equal(lockoutDurationMin(9), CAP_MIN);
  assert.equal(lockoutDurationMin(20), CAP_MIN);
});

test("escalation advances until the cap is hit, then resets to 0", () => {
  assert.equal(nextLevel(0), 1);
  assert.equal(nextLevel(7), 8);
  // level 8 = 1280m (< cap) → advances
  assert.equal(nextLevel(8), 9);
  // level 9 = clamped 1440m (the cap) → "goes back down to 0"
  assert.equal(nextLevel(9), 0);
  assert.equal(nextLevel(15), 0);
});

test("humanizeDuration formats minutes and hours", () => {
  assert.equal(humanizeDuration(5 * 60), "5 minutes");
  assert.equal(humanizeDuration(60), "1 minute");
  assert.equal(humanizeDuration(160 * 60), "2 hours 40 minutes");
  assert.equal(humanizeDuration(60 * 60), "1 hour");
  assert.equal(humanizeDuration(CAP_MIN * 60), "24 hours");
});

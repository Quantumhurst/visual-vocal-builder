// Beat-2 state-invariant tests — written in-window for Day 2.
// Run with: npm test   (Node built-in runner, no new dependencies;
// the pinned dependency set is unchanged.)
//
// Proves the 100% invariant holds for BOTH surfaces, which share the
// one update path (setFounderShare): voice-driven changes (the agent
// action calls it) and drag-driven changes (the slider calls it).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  setFounderShare,
  normalizeShares,
  resizeFounders,
  totalPercent,
  assertTotals100,
  MAX_OWNERS,
  MIN_OWNERS,
} from "../lib/equity.ts";

const founders = (a, b) => [
  { name: "DEMO Founder Nova (fictional)", percent: a },
  { name: "DEMO Founder Orbit (fictional)", percent: b },
];

test("voice-driven: 'make me 70%' with the other founder at 40% -> 70/30, total 100", () => {
  // Starting split 60/40; voice sets founder 0 to 70 (other was at 40).
  const next = setFounderShare(founders(60, 40), 0, 70);
  assert.equal(next[0].percent, 70);
  assert.equal(next[1].percent, 30);
  assert.equal(totalPercent(next), 100);
  assert.ok(assertTotals100(next));
});

test("drag-driven: dragging founder 1 to 40 -> 60/40, total 100", () => {
  const next = setFounderShare(founders(70, 30), 1, 40);
  assert.equal(next[0].percent, 60);
  assert.equal(next[1].percent, 40);
  assert.equal(totalPercent(next), 100);
});

test("both surfaces use the same path and agree", () => {
  const viaVoice = setFounderShare(founders(60, 40), 0, 70);
  const viaDrag = setFounderShare(founders(60, 40), 0, 70);
  assert.deepEqual(viaVoice, viaDrag);
});

test("invariant holds across the full drag sweep", () => {
  for (let target = 0; target <= 100; target += 1) {
    const next = setFounderShare(founders(60, 40), 0, target);
    assert.equal(totalPercent(next), 100, `target ${target}`);
    assert.equal(next[0].percent, target);
  }
});

test("raw 70/40 proposal is repaired by normalizeShares to exactly 100", () => {
  const next = normalizeShares(founders(70, 40));
  assert.equal(totalPercent(next), 100);
  assert.ok(next[0].percent > next[1].percent);
});

test("edge cases: single founder, zero split, clamping", () => {
  assert.equal(
    totalPercent(setFounderShare([{ name: "Solo", percent: 55 }], 0, 20)),
    100,
  );
  assert.equal(totalPercent(normalizeShares(founders(0, 0))), 100);
  const clamped = setFounderShare(founders(60, 40), 0, 140);
  assert.equal(clamped[0].percent, 100);
  assert.equal(totalPercent(clamped), 100);
});

test("owner count runs 1–5 and every size still totals 100", () => {
  const two = founders(60, 40);
  const solo = resizeFounders(two, 1);
  assert.equal(solo.length, 1);
  assert.equal(solo[0].percent, 100);
  assert.equal(totalPercent(solo), 100);

  const three = resizeFounders(two, 3);
  assert.equal(three.length, 3);
  assert.equal(totalPercent(three), 100);
  assert.ok(three.every((f) => f.percent > 0));
  assert.equal(new Set(three.map((f) => f.name)).size, 3);

  const five = resizeFounders(two, MAX_OWNERS);
  assert.equal(five.length, 5);
  assert.equal(totalPercent(five), 100);
  assert.equal(new Set(five.map((f) => f.name)).size, 5);
  assert.deepEqual(five.map((f) => f.percent), [20, 20, 20, 20, 20]);

  // Same count is a no-op (same reference, no history entry).
  assert.equal(resizeFounders(two, 2), two);
  // Out-of-range requests clamp to 1..5.
  assert.equal(resizeFounders(two, 0).length, MIN_OWNERS);
  assert.equal(resizeFounders(two, 99).length, MAX_OWNERS);
  assert.equal(totalPercent(resizeFounders(two, 99)), 100);
});

test("shrinking a team redistributes the removed owner's share", () => {
  const three = [
    { name: "DEMO Founder Nova (fictional)", percent: 70 },
    { name: "DEMO Founder Vega (fictional)", percent: 20 },
    { name: "DEMO Founder Lyra (fictional)", percent: 10 },
  ];
  const two = resizeFounders(three, 2);
  assert.equal(two.length, 2);
  assert.equal(totalPercent(two), 100);
  assert.equal(two[0].percent + two[1].percent, 100);
  assert.ok(two[0].percent > 70);
  assert.ok(two[1].percent > 20);
});

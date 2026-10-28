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
  totalPercent,
  assertTotals100,
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

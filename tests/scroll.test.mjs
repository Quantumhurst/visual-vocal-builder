import { test } from "node:test";
import assert from "node:assert/strict";
import { turnResultSignature, shouldAutoScroll, computeScrollTop, firstChangedBeat, computeSectionScrollTop, beatFieldChanged } from "../lib/scroll.ts";
import { withDefaults, applyJurisdiction, applyEquity, applyRolloverFact } from "../lib/state-updates.ts";

const base = () => withDefaults(null);

test("signature changes on jurisdiction pick even though beat stays jurisdiction (Turn 1)", () => {
  const before = turnResultSignature(base(), "Pick your home base");
  const after = turnResultSignature(applyJurisdiction(base(), "Europa"), "Europa it is");
  assert.notEqual(after, before);
  assert.match(after, /Europa/);
});

test("signature changes on equity turn and encodes the split", () => {
  const s0 = applyJurisdiction(base(), "Europa");
  const before = turnResultSignature(s0, "host");
  const after = turnResultSignature(applyEquity(s0, 0, 70, "voice"), "host");
  assert.notEqual(after, before);
  assert.match(after, /70/);
  assert.match(after, /30/);
});

test("signature changes when grounded rollover card arrives", () => {
  const before = turnResultSignature(base(), "host");
  const after = turnResultSignature(applyRolloverFact(base(), "s85-what-it-is", "What is a section 85 rollover?"), "host");
  assert.notEqual(after, before);
  assert.match(after, /s85-what-it-is/);
});

test("signature ignores transcript-only change (send moment is not a result)", () => {
  const a = turnResultSignature(base(), "host");
  const b = turnResultSignature({ ...base(), transcript: "Pick Europa" }, "host");
  assert.equal(a, b);
});

test("shouldAutoScroll only when idle and signature is new", () => {
  assert.equal(shouldAutoScroll(false, "a", "b"), true);
  assert.equal(shouldAutoScroll(true, "a", "b"), false);
  assert.equal(shouldAutoScroll(false, "a", "a"), false);
  assert.equal(shouldAutoScroll(false, null, "a"), false);
});

test("computeScrollTop leaves room for the sticky latest-turn header", () => {
  assert.equal(computeScrollTop(1000, 300), 688);
  assert.equal(computeScrollTop(100, 300), 0);
  assert.equal(computeScrollTop(1000, 0), 988);
});

test("firstChangedBeat picks the earliest changed section on the page", () => {
  const s0 = base();
  const prev = turnResultSignature(s0, "host a");
  // Jurisdiction pick that also advances the checklist still headlines jurisdiction.
  const picked = applyJurisdiction(s0, "Europa");
  const both = turnResultSignature({ ...picked, checklist: picked.checklist.map((i, ix) => ix === 0 ? { ...i, done: true } : i), currentBeat: "checklist" }, "host b");
  assert.equal(firstChangedBeat(prev, both, "checklist"), "jurisdiction");
  // Equity-only change headlines equity.
  const eq = turnResultSignature(applyEquity(s0, 0, 70, "voice"), "host b");
  assert.equal(firstChangedBeat(prev, eq, "equity"), "equity");
  // Host-only change falls back to the current beat.
  const hostOnly = turnResultSignature(s0, "host b");
  assert.equal(firstChangedBeat(prev, hostOnly, "rollover"), "rollover");
  assert.equal(firstChangedBeat(null, hostOnly, "rollover"), "rollover");
});

test("computeSectionScrollTop shows the section end at the viewport bottom", () => {
  assert.equal(computeSectionScrollTop(1000, 800, 700), 1100);
  assert.equal(computeSectionScrollTop(100, 200, 700), 0);
});

test("beatFieldChanged ignores host-only streaming updates", () => {
  const s0 = base();
  const prev = turnResultSignature(s0, "host a");
  assert.equal(beatFieldChanged(prev, turnResultSignature(s0, "host b, still streaming")), false);
  assert.equal(beatFieldChanged(prev, turnResultSignature(applyEquity(s0, 0, 70, "voice"), "host b")), true);
  assert.equal(beatFieldChanged(null, prev), false);
});

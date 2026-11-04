// The whole required journey, as pure state transitions. This is the
// contract the voice walk exercises: Enter -> home base -> company name
// -> owners/equity -> confirm -> 5/5 colony -> lawyer summary.
// Nothing files, nothing sends, and the journey has no tax-rollover lesson.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyChecklistCount,
  applyCompanyName,
  applyEquity,
  applyJurisdiction,
  applyLawyerSummary,
  applyOwnerCount,
  applyStartOver,
  withDefaults,
} from "../lib/state-updates.ts";
import { beatProgress } from "../lib/beat-progress.ts";
import { missionFor } from "../lib/mission.ts";
import { verifyPaintedCards } from "../lib/verifier.ts";

function walk() {
  const steps = [];
  let state = withDefaults(null);
  const snap = (label) => {
    const progress = beatProgress(state);
    steps.push({
      label,
      nextBeat: progress.nextBeat,
      mission: missionFor(state).beat,
      currentBeat: state.currentBeat,
    });
  };
  snap("enter");

  state = applyJurisdiction(state, "Mars");
  snap("home base");

  state = applyCompanyName(state);
  snap("name");

  state = applyOwnerCount(state, 4);
  state = applyEquity(state, 0, 40, "voice");
  snap("equity");

  state = applyChecklistCount(state, "all");
  snap("5/5");

  state = applyLawyerSummary(state);
  snap("summary");

  return { state, steps };
}

test("the journey advances in the required order, one beat at a time", () => {
  const { state, steps } = walk();
  assert.deepEqual(
    steps.map((step) => step.nextBeat),
    ["jurisdiction", "name", "equity", "checklist", "summary", "complete"],
  );
  assert.equal(state.founders.length, 4);
  assert.equal(state.founders.reduce((sum, founder) => sum + founder.percent, 0), 100);
  assert.equal(state.checklist.filter((item) => item.done).length, 5);
  assert.match(state.companyName, /Galactic Bagels/);
  assert.ok(state.lawyerPackage.length > 0);
});

test("every step has one visible, sayable next cue", () => {
  const expected = [
    ["jurisdiction", /Pick Mars/],
    ["name", /Approve Galactic Bagels/],
    ["equity", /Make Orbit 70%/],
    ["checklist", /^Yes$/],
    ["summary", /Prepare the lawyer summary/],
  ];
  let state = withDefaults(null);
  for (const [beat, pattern] of expected) {
    assert.equal(beatProgress(state).nextBeat, beat);
    assert.match(missionFor(state).voiceCue, pattern);
    assert.equal(missionFor(state).chips.length, 1);
    if (beat === "jurisdiction") state = applyJurisdiction(state, "Mars");
    if (beat === "name") state = applyCompanyName(state);
    if (beat === "equity") state = applyEquity(state, 0, 70, "voice");
    if (beat === "checklist") state = applyChecklistCount(state, "all");
    if (beat === "summary") state = applyLawyerSummary(state);
  }
  assert.equal(beatProgress(state).nextBeat, "complete");
});

test("the company name is approved before equity, not after the build", () => {
  let state = applyJurisdiction(withDefaults(null), "Mars");
  assert.equal(beatProgress(state).nextBeat, "name");
  assert.equal(missionFor(state).beat, "name");
  state = applyCompanyName(state);
  assert.equal(beatProgress(state).nextBeat, "equity");
  assert.equal(missionFor(state).beat, "equity");
});

test("the grounded cards that remain verify clean", () => {
  const { state } = walk();
  const verified = verifyPaintedCards(state);
  assert.equal(verified.counts.flagged, 0);
  assert.ok(verified.counts.grounded >= state.checklist.length);
});

test("the lawyer summary carries the approved name, the split, 5/5, and no tax-rollover claim", () => {
  const { state } = walk();
  const pkg = state.lawyerPackage;
  assert.match(pkg, /Galactic Bagels/);
  assert.match(pkg, /Mars/);
  assert.match(pkg, /40%/);
  assert.match(pkg, /\[x\]/);
  assert.match(pkg, /not legal advice, not a filing, and nothing here is submitted/i);
  assert.match(pkg, /does not send email/i);
  assert.doesNotMatch(pkg, /filed successfully|submitted to the registry/i);
  assert.doesNotMatch(pkg, /rollover/i);
  assert.doesNotMatch(pkg, /Commander/i);
});

test("start over clears the company name and the whole walk", () => {
  const { state } = walk();
  const reset = applyStartOver(state);
  assert.equal(reset.currentBeat, "jurisdiction");
  assert.equal(reset.selectedJurisdiction, null);
  assert.equal(reset.companyName, "");
  assert.equal(reset.lawyerPackage, "");
  assert.equal(reset.checklist.filter((item) => item.done).length, 0);
  // The prepared package is a snapshot; it never claims a live filing.
  assert.match(state.lawyerPackage, /Demo data only/);
});

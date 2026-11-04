// The whole required journey, as pure state transitions. This is the
// contract the voice walk exercises: Enter -> home base -> owners/equity
// -> confirm -> 5/5 colony -> approve name -> grounded s.85 -> lawyer
// summary. Nothing files, nothing sends.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyChecklistCount,
  applyCompanyName,
  applyEquity,
  applyJurisdiction,
  applyLawyerSummary,
  applyOwnerCount,
  applyRolloverFact,
  applyStartOver,
  withDefaults,
} from "../lib/state-updates.ts";
import { beatProgress } from "../lib/beat-progress.ts";
import { missionFor } from "../lib/mission.ts";
import { verifyPaintedCards } from "../lib/verifier.ts";
import { S85_PACK } from "../lib/knowledge.ts";

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

  state = applyOwnerCount(state, 4);
  state = applyEquity(state, 0, 40, "voice");
  snap("equity");

  state = applyChecklistCount(state, "all");
  snap("5/5");

  state = applyCompanyName(state, "Galactic Bagels Inc. (fictional)");
  snap("name");

  state = applyRolloverFact(state, "s85-what-it-is", "What is a section 85 rollover?");
  snap("s85");

  state = applyLawyerSummary(state);
  snap("summary");

  return { state, steps };
}

test("the journey advances in the required order, one beat at a time", () => {
  const { state, steps } = walk();
  assert.deepEqual(
    steps.map((step) => step.nextBeat),
    ["jurisdiction", "equity", "checklist", "name", "rollover", "summary", "complete"],
  );
  assert.equal(state.founders.length, 4);
  assert.equal(state.founders.reduce((sum, founder) => sum + founder.percent, 0), 100);
  assert.equal(state.checklist.filter((item) => item.done).length, 5);
  assert.match(state.companyName, /Galactic Bagels/);
  assert.equal(state.rolloverCard?.factId, "s85-what-it-is");
  assert.ok(state.lawyerPackage.length > 0);
});

test("every step has one visible, sayable next cue", () => {
  const expected = [
    ["jurisdiction", /Pick Mars/],
    ["equity", /Make Orbit 70%/],
    ["checklist", /Build the next structure|Finish the build/],
    ["name", /Approve Galactic Bagels/],
    ["rollover", /Explain section 85/],
    ["summary", /Prepare the lawyer summary/],
  ];
  let state = withDefaults(null);
  for (const [beat, pattern] of expected) {
    assert.equal(beatProgress(state).nextBeat, beat);
    assert.match(missionFor(state).voiceCue, pattern);
    if (beat === "jurisdiction") state = applyJurisdiction(state, "Mars");
    if (beat === "equity") state = applyEquity(state, 0, 70, "voice");
    if (beat === "checklist") state = applyChecklistCount(state, "all");
    if (beat === "name") state = applyCompanyName(state);
    if (beat === "rollover") state = applyRolloverFact(state, "s85-what-it-is", "s85?");
    if (beat === "summary") state = applyLawyerSummary(state);
  }
  assert.equal(beatProgress(state).nextBeat, "complete");
});

test("the grounded s.85 card is verbatim pack text and verifies clean", () => {
  const { state } = walk();
  const packFact = S85_PACK.facts.find((fact) => fact.factId === "s85-what-it-is");
  assert.ok(packFact);
  assert.equal(state.rolloverCard.answer, packFact.text);
  assert.equal(state.rolloverCard.packId, S85_PACK.packId);
  const verified = verifyPaintedCards(state);
  assert.equal(verified.counts.flagged, 0);
  assert.ok(verified.counts.grounded >= state.checklist.length + 1);
});

test("the lawyer summary carries the approved name, the split, 5/5, and the grounding", () => {
  const { state } = walk();
  const pkg = state.lawyerPackage;
  assert.match(pkg, /Galactic Bagels/);
  assert.match(pkg, /Mars/);
  assert.match(pkg, /40%/);
  assert.match(pkg, /\[x\]/);
  assert.match(pkg, /s85-what-it-is|s85-eligible|s85-elected|s85-share|s85-filing/);
  assert.match(pkg, /not legal advice, not a filing, and nothing here is submitted/i);
  assert.match(pkg, /does not send email/i);
  assert.doesNotMatch(pkg, /filed successfully|submitted to the registry/i);
});

test("start over clears the company name and the whole walk", () => {
  const { state } = walk();
  const reset = applyStartOver(state);
  assert.equal(reset.currentBeat, "jurisdiction");
  assert.equal(reset.selectedJurisdiction, null);
  assert.equal(reset.companyName, "");
  assert.equal(reset.rolloverCard, null);
  assert.equal(reset.lawyerPackage, "");
  assert.equal(reset.checklist.filter((item) => item.done).length, 0);
  // The prepared package is a snapshot; it never claims a live filing.
  assert.match(state.lawyerPackage, /Demo data only/);
});

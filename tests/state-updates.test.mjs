import { test } from "node:test";
import assert from "node:assert/strict";
import { INITIAL_STATE, withDefaults, resolveFounderIndex, applyEquity, applyChecklistItem, applyAdvanceChecklist, applyJurisdiction, applyRolloverFact, applyFilingSteps, applyLawyerSummary } from "../lib/state-updates.ts";

const base = () => withDefaults(null);
test("withDefaults partial/null", () => {
  assert.equal(withDefaults(null).currentBeat, "jurisdiction");
  assert.equal(withDefaults({ transcript: "hi" }).transcript, "hi");
  assert.equal(withDefaults(undefined).founders.length, INITIAL_STATE.founders.length);
});
test("resolveFounderIndex", () => {
  const f = base().founders;
  assert.equal(resolveFounderIndex(f, "me"), 0);
  assert.equal(resolveFounderIndex(f, "i"), 0);
  assert.equal(resolveFounderIndex(f, ""), 0);
  assert.equal(resolveFounderIndex(f, "orbit"), 1);
  assert.equal(resolveFounderIndex(f, "NOVA"), 0);
  assert.equal(resolveFounderIndex(f, "Zebra"), -1);
});
test("applyEquity totals 100", () => {
  const s = applyEquity(base(), 0, 70, "test");
  assert.equal(s.founders[0].percent, 70);
  assert.equal(s.founders.reduce((a,f)=>a+f.percent,0), 100);
  assert.equal(s.currentBeat, "equity");
});
test("applyChecklistItem and advance twice from same base marks two items", () => {
  const b = base();
  assert.equal(applyChecklistItem(b, b.checklist[0].id, true).checklist[0].done, true);
  const once = applyAdvanceChecklist(b);
  const twice = applyAdvanceChecklist(once);
  // advancing twice from same base via chaining marks two
  assert.equal(twice.checklist.filter(i=>i.done).length, 2);
  // also: applying twice starting from same base object sequentially (state threaded)
  let s = b; s = applyAdvanceChecklist(s); s = applyAdvanceChecklist(s);
  assert.equal(s.checklist.filter(i=>i.done).length, 2);
});
test("applyJurisdiction", () => {
  assert.equal(applyJurisdiction(base(), "Mars").selectedJurisdiction, "Mars");
  assert.equal(applyJurisdiction(base(), "Nope").selectedJurisdiction, null);
});
test("applyRolloverFact grounded and unknown", () => {
  const ok = applyRolloverFact(base(), "s85-what-it-is", "q?");
  assert.equal(ok.rolloverCard.packId, "corp-plan-ca-s85-rollover-v1");
  assert.equal(ok.rolloverCard.factId, "s85-what-it-is");
  const bad = applyRolloverFact(base(), "nope");
  assert.equal(bad.rolloverCard, null);
  assert.match(bad.rolloverNote, /No grounded fact/);
});
test("applyFilingSteps grounded and unknown", () => {
  const ok = applyFilingSteps(base(), ["steps-order-overview"], "q?");
  assert.equal(ok.filingStepsCard.packId, "corp-plan-filing-steps-fees-v1");
  assert.equal(ok.filingStepsCard.facts[0].factId, "steps-order-overview");
  assert.equal(applyFilingSteps(base(), ["nope"]).filingStepsCard, null);
});
test("applyLawyerSummary", () => {
  const s = applyLawyerSummary(base());
  assert.equal(s.currentBeat, "summary");
  assert.match(s.lawyerPackage, /Galactic Bagels/);
  assert.match(s.lawyerNote, /does not send email/);
});

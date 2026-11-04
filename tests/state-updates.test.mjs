import { test } from "node:test";
import assert from "node:assert/strict";
import { INITIAL_STATE, withDefaults, resolveFounderIndex, applyEquity, applyChecklistItem, applyChecklistItems, applyAdvanceChecklist, applyJurisdiction, applyFilingSteps, applyLawyerSummary, applyFocusJurisdiction, applyStartOver, cheapestByNumber, applyOwnerCount, applyChecklistCount, applyCompanyName, normalizeCompanyName, parseSpokenCompanyName } from "../lib/state-updates.ts";
import { DEMO_JURISDICTIONS } from "../lib/demo-data.ts";

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
test("applyFilingSteps grounded and unknown", () => {
  const ok = applyFilingSteps(base(), ["steps-order-overview"], "q?");
  assert.equal(ok.filingStepsCard.packId, "corp-plan-filing-steps-fees-v1");
  assert.equal(ok.filingStepsCard.facts[0].factId, "steps-order-overview");
  assert.equal(applyFilingSteps(base(), ["nope"]).filingStepsCard, null);
});
test("applyChecklistItems ticks several at once", () => {
  const b = base();
  const ids = [b.checklist[0].id, b.checklist[1].id];
  const s = applyChecklistItems(b, ids, true);
  assert.equal(s.checklist.filter((i) => i.done).length, 2);
  assert.equal(applyChecklistItems(s, ids, false).checklist.filter((i) => i.done).length, 0);
});
test("applyStartOver keeps transcript, resets canvas", () => {
  let s = applyJurisdiction(base(), "Mars");
  s = { ...applyEquity(s, 1, 70, "test"), transcript: "keep me" };
  const out = applyStartOver(s);
  assert.equal(out.transcript, "keep me");
  assert.equal(out.selectedJurisdiction, null);
  assert.equal(out.founders[0].percent, 60);
  assert.equal(out.checklist.filter((i) => i.done).length, 0);
  assert.equal(out.companyName, "");
  assert.equal(out.lawyerPackage, "");
});
test("applyFocusJurisdiction does not change selection", () => {
  const s = applyJurisdiction(base(), "Mars");
  const out = applyFocusJurisdiction(s, "Europa", "cheapest by number");
  assert.equal(out.selectedJurisdiction, "Mars");
  assert.equal(out.focusJurisdiction, "Europa");
  assert.match(out.focusReason, /cheapest/);
});
test("cheapestByNumber returns Europa with sameCurrency false", () => {
  const c = cheapestByNumber(DEMO_JURISDICTIONS);
  assert.equal(c.name, "Europa");
  assert.match(c.fee, /DEMO 400/);
  assert.equal(c.sameCurrency, false);
});
test("applyLawyerSummary uses the name the founder approved, never an assumed one", () => {
  const unnamed = applyLawyerSummary(base());
  assert.equal(unnamed.currentBeat, "summary");
  assert.match(unnamed.lawyerPackage, /company name not chosen yet/);
  assert.doesNotMatch(unnamed.lawyerPackage, /Galactic Bagels/);
  assert.match(unnamed.lawyerNote, /does not send email/);

  // Ticking the "Pick a company name" structure is not approval.
  const builtOnly = base().checklist.reduce(
    (state, item) => applyChecklistItem(state, item.id, true),
    base(),
  );
  assert.match(applyLawyerSummary(builtOnly).lawyerPackage, /company name not chosen yet/);

  const approved = applyCompanyName(builtOnly, undefined);
  assert.equal(approved.currentBeat, "name");
  assert.match(approved.companyName, /^Galactic Bagels Inc\. \(fictional\)$/);
  const named = applyLawyerSummary(approved);
  assert.match(named.lawyerPackage, /Galactic Bagels/);
});

test("normalizeCompanyName always marks a fictional demo name", () => {
  assert.match(normalizeCompanyName(""), /Galactic Bagels/);
  assert.equal(normalizeCompanyName("Cosmic Donuts"), "Cosmic Donuts (fictional)");
  assert.equal(normalizeCompanyName("Cosmic Donuts (fictional)"), "Cosmic Donuts (fictional)");
  assert.equal(normalizeCompanyName("  Starlight   Coffee  "), "Starlight Coffee (fictional)");
  assert.equal(parseSpokenCompanyName("call it Cosmic Donuts"), "Cosmic Donuts");
  assert.equal(parseSpokenCompanyName("approve Galactic Bagels"), null);
});

test("applyOwnerCount supports 1–5 owners and keeps the split at 100", () => {
  const b = base();
  const solo = applyOwnerCount(b, 1);
  assert.equal(solo.founders.length, 1);
  assert.equal(solo.founders[0].percent, 100);
  assert.equal(solo.currentBeat, "equity");
  assert.match(solo.equityNote, /1 owner/);

  const three = applyOwnerCount(b, 3);
  assert.equal(three.founders.length, 3);
  assert.equal(three.founders.reduce((sum, f) => sum + f.percent, 0), 100);
  assert.ok(three.founders.every((f) => f.percent > 0));
  assert.match(three.equityNote, /3 owners/);

  // No count change -> same state object (no phantom undo step).
  assert.equal(applyOwnerCount(b, 2), b);
});

test("applyChecklistCount ticks the first N undone, or all remaining", () => {
  const b = base();
  const two = applyChecklistCount(b, 2);
  assert.equal(two.checklist.filter((i) => i.done).length, 2);
  assert.equal(two.currentBeat, "checklist");
  const all = applyChecklistCount(b, "all");
  assert.equal(all.checklist.filter((i) => i.done).length, 5);
  const none = applyChecklistCount(b, 0);
  assert.equal(none, b);
  const more = applyChecklistCount(b, 99);
  assert.equal(more.checklist.filter((i) => i.done).length, 5);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { missionFor } from "../lib/mission.ts";
import { spokenHostText } from "../lib/spoken-text.ts";
import {
  applyChecklistItem,
  applyCompanyName,
  applyEquity,
  applyJurisdiction,
  applyLawyerSummary,
  applyRolloverFact,
  withDefaults,
} from "../lib/state-updates.ts";
import { CHECKLIST_PACK } from "../lib/knowledge.ts";

const base = () => withDefaults(null);
const allChecklist = () => CHECKLIST_PACK.facts.map((fact) => fact.factId);

test("mission follows the next incomplete beat", () => {
  const m1 = missionFor(base());
  assert.equal(m1.beat, "jurisdiction");
  assert.equal(m1.step, 1);
  assert.equal(m1.total, 6);
  assert.equal(m1.voiceCue, "Pick Mars");
  assert.equal(m1.chips.length, 1);
  assert.match(m1.chips[0].command, /Mars/);
  const s2 = applyEquity(applyJurisdiction(base(), "Mars"), 1, 70, "test");
  const m2 = missionFor(s2);
  assert.equal(m2.beat, "checklist");
  assert.equal(m2.voiceCue, "Yes");
  assert.equal(m2.chips.length, 1);
});

test("every mission has one sayable cue, one prompt, and exactly one chip", () => {
  for (const state of [
    base(),
    applyJurisdiction(base(), "Mars"),
    applyEquity(applyJurisdiction(base(), "Mars"), 0, 70, "test"),
    (() => {
      let s = applyEquity(applyJurisdiction(base(), "Mars"), 0, 70, "test");
      for (const id of allChecklist()) s = applyChecklistItem(s, id, true);
      return s;
    })(),
    applyCompanyName(base()),
    applyRolloverFact(base(), "s85-what-it-is", "what is s.85?"),
  ]) {
    const m = missionFor(state);
    assert.ok(m.prompt.length > 10);
    assert.ok(m.voiceCue.length >= 2);
    assert.equal(m.total, 6);
    assert.equal(m.chips.length, 1, `${m.beat}: one next action, never a wall`);
    assert.ok(m.chips[0].label && m.chips[0].command);
  }
});

test("the primary prompt never offers a menu of alternatives", () => {
  for (const state of [
    base(),
    applyJurisdiction(base(), "Mars"),
    applyEquity(applyJurisdiction(base(), "Mars"), 0, 70, "test"),
    applyCompanyName(base()),
    applyRolloverFact(base(), "s85-what-it-is", "what is s.85?"),
  ]) {
    const m = missionFor(state);
    assert.doesNotMatch(m.prompt, /\bor\b/i, `${m.beat} prompt`);
    assert.doesNotMatch(m.prompt, /, or /i, `${m.beat} prompt`);
    assert.doesNotMatch(m.prompt, /choose 1|1–5 options|options:/i, `${m.beat} prompt`);
  }
});

function completeChain(checklistIds) {
  let s = applyJurisdiction(base(), "Mars");
  s = applyEquity(s, 0, 70, "test");
  for (const id of checklistIds) s = applyChecklistItem(s, id, true);
  s = applyCompanyName(s);
  s = applyRolloverFact(s, "s85-what-it-is", "what is s.85?");
  s = applyLawyerSummary(s);
  return s;
}

test("a half-built colony stays on the build mission, not the next beat", () => {
  const one = CHECKLIST_PACK.facts[0].factId;
  const m = missionFor(completeChain([one]));
  assert.equal(m.beat, "checklist");
  assert.match(m.title, /Build the colony/i);
  assert.match(m.prompt, /Structure 2 of 5: Habitat dome/);
  assert.equal(m.chips.length, 1);
  assert.match(m.chips[0].label, /Raise the habitat dome/);
  assert.equal(m.chips[0].command, "Yes");
  assert.doesNotMatch(m.title, /founded/i);
});

test("a fully built and approved colony is called founded", () => {
  const all = CHECKLIST_PACK.facts.map((fact) => fact.factId);
  const m = missionFor(completeChain(all));
  assert.equal(m.beat, "complete");
  assert.match(m.title, /founded/i);
  assert.match(m.prompt, /nothing was filed/i);
  assert.match(m.voiceCue, /Show transcript/i);
  assert.equal(m.chips.length, 1);
});

test("spoken text keeps Inc. and s.85 from being split as sentences", () => {
  const nameLine = "Company name approved as Galactic Bagels Inc. (fictional). Say “Explain section 85” to see the grounded rollover fact.";
  assert.match(spokenHostText(nameLine), /Explain section 85/);
  const fact = "Under s.85(1) of the Canada Income Tax Act, a taxpayer and a taxable Canadian corporation can jointly elect to transfer eligible property to the corporation on a tax-deferred (rollover) basis, so tax on the accrued gain is deferred rather than triggered on the transfer.";
  assert.match(spokenHostText(fact), /^Under s\.85\(1\)/);
  assert.match(spokenHostText(fact), /on the transfer\.$/);
});

test("spoken text is capped to two short sentences", () => {
  const long = "First sentence here. Second one follows! Third should be dropped? Fourth too.";
  assert.equal(spokenHostText(long), "First sentence here. Second one follows!");
  assert.equal(spokenHostText(""), "");
  assert.equal(spokenHostText("One only."), "One only.");
  assert.ok(spokenHostText("x".repeat(400)).length <= 283);
});

test("the grounded s.85 lesson is a required beat, not an archive", () => {
  let state = applyJurisdiction(base(), "Mars");
  state = applyEquity(state, 0, 70, "test");
  for (const fact of CHECKLIST_PACK.facts) {
    state = applyChecklistItem(state, fact.factId, true);
  }
  state = applyCompanyName(state);
  assert.equal(missionFor(state).beat, "rollover");
  assert.match(missionFor(state).voiceCue, /Explain section 85/);
  assert.equal(missionFor(state).total, 6);
});

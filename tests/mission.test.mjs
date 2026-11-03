import { test } from "node:test";
import assert from "node:assert/strict";
import { missionFor } from "../lib/mission.ts";
import { spokenHostText } from "../lib/spoken-text.ts";
import {
  applyChecklistItem,
  applyEquity,
  applyFilingSteps,
  applyJurisdiction,
  applyLawyerSummary,
  applyRolloverFact,
  withDefaults,
} from "../lib/state-updates.ts";
import { CHECKLIST_PACK, FILING_STEPS_PACK } from "../lib/knowledge.ts";

const base = () => withDefaults(null);

test("mission follows the next incomplete beat", () => {
  const m1 = missionFor(base());
  assert.equal(m1.beat, "jurisdiction");
  assert.equal(m1.step, 1);
  assert.ok(m1.chips.some((c) => /Mars/.test(c.command)));
  const s2 = applyEquity(applyJurisdiction(base(), "Mars"), 1, 70, "test");
  const m2 = missionFor(s2);
  assert.equal(m2.beat, "checklist");
  assert.ok(m2.chips.length >= 1);
});

test("every mission has a sayable prompt and at least one chip", () => {
  const m = missionFor(base());
  assert.ok(m.prompt.length > 10);
  assert.ok(m.total, 6);
  for (const chip of m.chips) {
    assert.ok(chip.label && chip.command);
  }
});

function completeChain(checklistIds) {
  let s = applyJurisdiction(base(), "Mars");
  s = applyEquity(s, 0, 70, "test");
  for (const id of checklistIds) s = applyChecklistItem(s, id, true);
  s = applyRolloverFact(s, "s85-what-it-is", "what is s.85?");
  s = applyFilingSteps(s, [FILING_STEPS_PACK.facts[0].factId], "steps?");
  s = applyLawyerSummary(s);
  return s;
}

test("a half-built colony stays on the build mission, not the next beat", () => {
  const one = CHECKLIST_PACK.facts[0].factId;
  const m = missionFor(completeChain([one]));
  assert.equal(m.beat, "checklist");
  assert.match(m.title, /Build the colony/i);
  assert.match(m.prompt, /1\/5/);
  assert.ok(m.chips.some((chip) => /Finish the build/i.test(chip.label)));
  assert.doesNotMatch(m.title, /founded/i);
});

test("a fully built colony is called founded", () => {
  const all = CHECKLIST_PACK.facts.map((fact) => fact.factId);
  const m = missionFor(completeChain(all));
  assert.equal(m.beat, "complete");
  assert.match(m.title, /founded/i);
  assert.match(m.prompt, /fully built/i);
});

test("spoken text is capped to two short sentences", () => {
  const long = "First sentence here. Second one follows! Third should be dropped? Fourth too.";
  assert.equal(spokenHostText(long), "First sentence here. Second one follows!");
  assert.equal(spokenHostText(""), "");
  assert.equal(spokenHostText("One only."), "One only.");
  assert.ok(spokenHostText("x".repeat(400)).length <= 283);
});

test("the optional s.85/filing archive is not required to finish", () => {
  let state = applyJurisdiction(base(), "Mars");
  state = applyEquity(state, 0, 70, "test");
  for (const fact of CHECKLIST_PACK.facts) {
    state = applyChecklistItem(state, fact.factId, true);
  }
  state = applyLawyerSummary(state);
  const m = missionFor(state);
  assert.equal(m.beat, "complete");
  assert.match(m.title, /founded/i);
  assert.equal(m.total, 4);
});

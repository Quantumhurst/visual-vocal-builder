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
  withDefaults,
} from "../lib/state-updates.ts";
import { CHECKLIST_PACK } from "../lib/knowledge.ts";

const base = () => withDefaults(null);
const allChecklist = () => CHECKLIST_PACK.facts.map((fact) => fact.factId);

test("mission follows the new five-beat order", () => {
  const m1 = missionFor(base());
  assert.equal(m1.beat, "jurisdiction");
  assert.equal(m1.step, 1);
  assert.equal(m1.total, 5);
  assert.equal(m1.voiceCue, "Pick Mars");
  assert.equal(m1.chips.length, 1);

  const m2 = missionFor(applyJurisdiction(base(), "Mars"));
  assert.equal(m2.beat, "name");
  assert.equal(m2.step, 2);
  assert.equal(m2.voiceCue, "Approve Galactic Bagels");

  const m3 = missionFor(applyCompanyName(applyJurisdiction(base(), "Mars")));
  assert.equal(m3.beat, "equity");
  assert.equal(m3.step, 3);
  assert.equal(m3.voiceCue, "Make Orbit 70%");
});

test("every mission has one sayable cue, one prompt, and exactly one chip", () => {
  for (const state of [
    base(),
    applyJurisdiction(base(), "Mars"),
    applyCompanyName(applyJurisdiction(base(), "Mars")),
    applyEquity(applyCompanyName(applyJurisdiction(base(), "Mars")), 0, 70, "test"),
    (() => {
      let s = applyEquity(applyCompanyName(applyJurisdiction(base(), "Mars")), 0, 70, "test");
      for (const id of allChecklist()) s = applyChecklistItem(s, id, true);
      return s;
    })(),
  ]) {
    const m = missionFor(state);
    assert.ok(m.prompt.length > 10);
    assert.ok(m.voiceCue.length >= 2);
    assert.equal(m.total, 5);
    assert.equal(m.chips.length, 1, `${m.beat}: one next action, never a wall`);
    assert.ok(m.chips[0].label && m.chips[0].command);
  }
});

test("the primary prompt never offers a menu of alternatives", () => {
  for (const state of [
    base(),
    applyJurisdiction(base(), "Mars"),
    applyCompanyName(applyJurisdiction(base(), "Mars")),
    applyEquity(applyCompanyName(applyJurisdiction(base(), "Mars")), 0, 70, "test"),
  ]) {
    const m = missionFor(state);
    assert.doesNotMatch(m.prompt, /\bor\b/i, `${m.beat} prompt`);
    assert.doesNotMatch(m.prompt, /, or /i, `${m.beat} prompt`);
    assert.doesNotMatch(m.prompt, /choose 1|1–5 options|options:/i, `${m.beat} prompt`);
  }
});

function completeChain(checklistIds) {
  let s = applyJurisdiction(base(), "Mars");
  s = applyCompanyName(s);
  s = applyEquity(s, 0, 70, "test");
  for (const id of checklistIds) s = applyChecklistItem(s, id, true);
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

test("the name beat does not require the colony to be built", () => {
  const s = applyJurisdiction(base(), "Mars");
  const m = missionFor(s);
  assert.equal(m.beat, "name");
  assert.doesNotMatch(m.prompt, /5\/5|colony is complete|after the colony/i);
  assert.match(m.prompt, /fictional company/i);
});

test("spoken text keeps Inc. from being split as a sentence", () => {
  const nameLine = "Company name approved as Galactic Bagels Inc. (fictional). Say “Make Orbit 70%”.";
  assert.match(spokenHostText(nameLine), /Make Orbit 70%/);
  assert.match(spokenHostText(nameLine), /^Company name approved as Galactic Bagels Inc\./);
});

test("spoken text keeps company .txt filenames whole", () => {
  const summary = "Downloaded galactic-bagels-summary.txt.";
  const transcript = "Downloaded galactic-bagels-transcript.txt.";
  assert.equal(spokenHostText(summary), summary);
  assert.equal(spokenHostText(transcript), transcript);
});

test("spoken text is capped to two short sentences", () => {
  const long = "First sentence here. Second one follows! Third should be dropped? Fourth too.";
  assert.equal(spokenHostText(long), "First sentence here. Second one follows!");
  assert.equal(spokenHostText(""), "");
  assert.equal(spokenHostText("One only."), "One only.");
  assert.ok(spokenHostText("x".repeat(400)).length <= 283);
});

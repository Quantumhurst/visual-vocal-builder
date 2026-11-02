import { test } from "node:test";
import assert from "node:assert/strict";
import { cueForChange, CUES } from "../lib/sound-cues.ts";
import { withDefaults, applyEquity, applyJurisdiction, applyChecklistItem, applyLawyerSummary, applyFocusJurisdiction } from "../lib/state-updates.ts";

const base = () => withDefaults(null);

test("each meaningful change maps to a distinct cue", () => {
  const b = base();
  assert.equal(cueForChange(b, applyJurisdiction(b, "Mars")), "select");
  assert.equal(cueForChange(b, applyEquity(b, 1, 70, "test")), "adjust");
  assert.equal(cueForChange(b, applyChecklistItem(b, b.checklist[0].id, true)), "build");
  assert.equal(cueForChange(b, applyLawyerSummary(applyJurisdiction(b, "Mars"))), "launch");
  assert.equal(cueForChange(b, applyFocusJurisdiction(b, "Europa", "comparison")), "highlight");
});

test("no change and unticking map to no triumphant cue", () => {
  const b = base();
  assert.equal(cueForChange(b, b), null);
  const ticked = applyChecklistItem(b, b.checklist[0].id, true);
  assert.equal(cueForChange(ticked, applyChecklistItem(ticked, b.checklist[0].id, false)), "adjust");
});

test("every cue has a synth recipe", () => {
  for (const name of ["select", "adjust", "build", "launch", "highlight", "card", "error"]) {
    assert.ok(CUES[name], name);
    assert.ok(CUES[name].notes.length >= 1, name);
  }
});

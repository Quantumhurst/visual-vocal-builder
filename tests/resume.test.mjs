import { test } from "node:test";
import assert from "node:assert/strict";
import { resumeSummary } from "../lib/resume.ts";
import { spokenHostText } from "../lib/spoken-text.ts";
import {
  applyChecklistItem,
  applyCompanyName,
  applyEquity,
  applyJurisdiction,
  applyOwnerCount,
  withDefaults,
} from "../lib/state-updates.ts";
import { CHECKLIST_PACK } from "../lib/knowledge.ts";

function savedRun() {
  let state = applyJurisdiction(withDefaults(null), "Mars");
  state = applyCompanyName(state);
  state = applyOwnerCount(state, 4);
  state = applyEquity(state, 0, 40, "test");
  for (const fact of CHECKLIST_PACK.facts.slice(0, 3)) {
    state = applyChecklistItem(state, fact.factId, true);
  }
  return state;
}

test("resume summary names home base, company, split, and build count", () => {
  const line = resumeSummary(savedRun());
  assert.match(line, /^Welcome back\./);
  assert.match(line, /Home base Mars/);
  assert.match(line, /Galactic Bagels/);
  assert.match(line, /40%\/20%\/20%\/20%/);
  assert.match(line, /colony 3\/5 built/);
  assert.equal(spokenHostText(line), line);
  assert.doesNotMatch(line, /Mission complete|lawyer summary ready|Show transcript/i);
});

test("resume summary remains one short line with an empty save", () => {
  const line = resumeSummary(withDefaults(null));
  assert.match(line, /home base not set/i);
  assert.match(line, /company not named/i);
  assert.match(line, /60%\/40%/);
  assert.match(line, /colony 0\/5 built/);
  assert.ok(line.length < 200);
});

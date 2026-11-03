// Local-path host copy: the visible line must follow the required task
// after a click or slider change, not stay on the previous task.

import { test } from "node:test";
import assert from "node:assert/strict";
import { checklistHostLine, equityConfirmationLine, nextObjectiveHostLine } from "../lib/build-host.ts";
import { applyOwnerCount } from "../lib/state-updates.ts";
import { CHECKLIST_PACK } from "../lib/knowledge.ts";
import {
  applyChecklistItem,
  applyEquity,
  applyJurisdiction,
  withDefaults,
} from "../lib/state-updates.ts";

const base = () => withDefaults(null);

test("after the equity split, the host line hands off to the build queue", () => {
  let state = applyJurisdiction(base(), "Mars");
  state = applyEquity(state, 0, 70, "test");
  const line = nextObjectiveHostLine(state);
  assert.match(line, /filing step from the five on the left/i);
  assert.match(line, /tick next step/i);
});

test("a checklist click reports the real count and names the next step", () => {
  let state = applyJurisdiction(base(), "Mars");
  state = applyEquity(state, 0, 70, "test");
  state = applyChecklistItem(state, CHECKLIST_PACK.facts[0].factId, true);
  const line = checklistHostLine(state);
  assert.match(line, /^1 of 5 structures online\./);
  assert.match(line, /Next: Pick a company name\./);
});

test("the fifth structure hands off to the lawyer summary", () => {
  let state = applyJurisdiction(base(), "Mars");
  state = applyEquity(state, 0, 70, "test");
  for (const fact of CHECKLIST_PACK.facts) {
    state = applyChecklistItem(state, fact.factId, true);
  }
  const line = checklistHostLine(state);
  assert.match(line, /^All 5 structures online\./);
  assert.match(line, /lawyer summary package/i);
});

test("unticking reports the reduced count and the reopened step", () => {
  let state = applyJurisdiction(base(), "Mars");
  state = applyEquity(state, 0, 70, "test");
  state = applyChecklistItem(state, CHECKLIST_PACK.facts[0].factId, true);
  state = applyChecklistItem(state, CHECKLIST_PACK.facts[0].factId, false);
  const line = checklistHostLine(state);
  assert.match(line, /^0 of 5 structures online\./);
  assert.match(line, /Next: Choose where to incorporate\./);
});

test("all required work complete uses a complete line, not a stale question", () => {
  let state = applyJurisdiction(base(), "Mars");
  state = applyEquity(state, 0, 70, "test");
  for (const fact of CHECKLIST_PACK.facts) {
    state = applyChecklistItem(state, fact.factId, true);
  }
  state = { ...state, lawyerPackage: "package" };
  assert.equal(nextObjectiveHostLine(state), "Mission complete — colony founded.");
});

test("equity confirmation reports the normalized split and owner count", () => {
  let state = applyJurisdiction(base(), "Mars");
  state = applyEquity(state, 0, 70, "test");
  assert.equal(equityConfirmationLine(state), "2 owners — 70% / 30%. Confirm this split, or choose another owner count.");
  state = applyOwnerCount(state, 3);
  assert.match(equityConfirmationLine(state), /^3 owners — \d+% \/ \d+% \/ \d+%\./);
  assert.match(equityConfirmationLine(state), /Confirm this split/);
  // The line is built from the normalized state, so it always totals 100.
  const percents = state.founders.map((founder) => founder.percent);
  assert.equal(percents.reduce((a, b) => a + b, 0), 100);
});

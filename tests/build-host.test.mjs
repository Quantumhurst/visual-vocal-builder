// Local-path host copy: the visible line must follow the required task
// after a click or slider change, not stay on the previous task.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildGuideLine,
  buildQuestionLine,
  buildRaisedLine,
  checklistHostLine,
  equityConfirmationLine,
  nameApprovalLine,
  nextObjectiveHostLine,
  rolloverLearnLine,
} from "../lib/build-host.ts";
import { applyOwnerCount, applyRolloverFact } from "../lib/state-updates.ts";
import { CHECKLIST_PACK } from "../lib/knowledge.ts";
import {
  applyChecklistItem,
  applyCompanyName,
  applyEquity,
  applyJurisdiction,
  withDefaults,
} from "../lib/state-updates.ts";

const base = () => withDefaults(null);

test("after the equity split, the host line hands off to the build queue", () => {
  let state = applyJurisdiction(base(), "Mars");
  state = applyEquity(state, 0, 70, "test");
  const line = nextObjectiveHostLine(state);
  assert.match(line, /^Structure 1 of 5: Landing pad —/);
  assert.match(line, /Say “yes” to raise it/);
});

test("a checklist click reports the real count and names the next step", () => {
  let state = applyJurisdiction(base(), "Mars");
  state = applyEquity(state, 0, 70, "test");
  state = applyChecklistItem(state, CHECKLIST_PACK.facts[0].factId, true);
  const line = checklistHostLine(state);
  assert.match(line, /^Structure 2 of 5: Habitat dome —/);
  assert.match(line, /Say “yes” to raise it/);
});

test("the guided build asks for exactly one yes before raising one structure", () => {
  const state = applyEquity(applyJurisdiction(base(), "Mars"), 0, 70, "test");
  const question = buildQuestionLine(state);
  assert.match(question, /^Structure 1 of 5: Landing pad —/);
  assert.match(question, /Say “yes” to raise it/);
  assert.doesNotMatch(question, /all five|finish the build|tell me more/i);
  const raised = buildRaisedLine(
    applyChecklistItem(state, CHECKLIST_PACK.facts[0].factId, true),
    "Landing pad",
  );
  assert.match(raised, /^Landing pad raised — 1 of 5 structures up\./);
  assert.match(raised, /Next: Habitat dome/);
  assert.doesNotMatch(raised, /or /);
  const guide = buildGuideLine(base().checklist[0]);
  assert.match(guide, /Say “yes” when you are ready to raise the Landing pad/);
  assert.doesNotMatch(guide, /not yet/);
});

test("the fifth structure hands off to the company-name approval", () => {
  let state = applyJurisdiction(base(), "Mars");
  state = applyEquity(state, 0, 70, "test");
  for (const fact of CHECKLIST_PACK.facts) {
    state = applyChecklistItem(state, fact.factId, true);
  }
  const line = checklistHostLine(state);
  assert.match(line, /Colony complete — five of five/);
  assert.match(line, /Approve Galactic Bagels/);
  // Two sentences, so the spoken-text cap never drops the question.
  assert.ok((line.match(/[.!?](?:\s|$)/g) ?? []).length <= 2);
});

test("the explicit name-approval line is the same question the banner shows", () => {
  let state = applyJurisdiction(base(), "Mars");
  state = applyEquity(state, 0, 70, "test");
  for (const fact of CHECKLIST_PACK.facts) {
    state = applyChecklistItem(state, fact.factId, true);
  }
  assert.match(nameApprovalLine(state), /Colony complete — five of five/);
  assert.match(nameApprovalLine(state), /Approve Galactic Bagels/);
  assert.doesNotMatch(nameApprovalLine(state), /Call it/);
});

test("the rollover lesson speaks the grounded pack sentence verbatim", () => {
  const state = applyRolloverFact(base(), "s85-what-it-is", "what is a section 85 rollover?");
  const line = rolloverLearnLine(state);
  assert.match(line, /^Under s\.85\(1\) of the Canada Income Tax Act/);
  assert.ok(line.length <= 283);
});

test("unticking reports the reduced count and the reopened step", () => {
  let state = applyJurisdiction(base(), "Mars");
  state = applyEquity(state, 0, 70, "test");
  state = applyChecklistItem(state, CHECKLIST_PACK.facts[0].factId, true);
  state = applyChecklistItem(state, CHECKLIST_PACK.facts[0].factId, false);
  const line = checklistHostLine(state);
  assert.match(line, /^Structure 1 of 5: Landing pad —/);
  assert.match(line, /Say “yes” to raise it/);
});

test("all required work complete uses a complete line, not a stale question", () => {
  let state = applyJurisdiction(base(), "Mars");
  state = applyEquity(state, 0, 70, "test");
  for (const fact of CHECKLIST_PACK.facts) {
    state = applyChecklistItem(state, fact.factId, true);
  }
  state = applyCompanyName(state);
  state = applyRolloverFact(state, "s85-what-it-is", "what is s.85?");
  state = { ...state, lawyerPackage: "package" };
  assert.equal(nextObjectiveHostLine(state), "Mission complete — colony founded.");
});

test("equity confirmation reports the normalized split and owner count", () => {
  let state = applyJurisdiction(base(), "Mars");
  state = applyEquity(state, 0, 70, "test");
  assert.equal(
    equityConfirmationLine(state),
    "2 owners — 70% / 30%. Does this ownership look right?",
  );
  state = applyOwnerCount(state, 3);
  assert.match(equityConfirmationLine(state), /^3 owners — \d+% \/ \d+% \/ \d+%\./);
  assert.match(equityConfirmationLine(state), /Does this ownership look right\?/);
  assert.doesNotMatch(equityConfirmationLine(state), /say the percentages|drag a slider/i);
  // The line is built from the normalized state, so it always totals 100.
  const percents = state.founders.map((founder) => founder.percent);
  assert.equal(percents.reduce((a, b) => a + b, 0), 100);
});

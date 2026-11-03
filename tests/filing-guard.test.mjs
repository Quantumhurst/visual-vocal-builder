// The filing guard answer is local: fixed copy, no model turn, no state.

import { test } from "node:test";
import assert from "node:assert/strict";
import { FILING_GUARD_REPLY, isFilingGuardQuestion } from "../lib/filing-guard.ts";

test("the demo filing guard question is recognised", () => {
  for (const text of [
    "Is this actually going to file my company?",
    "Will this file my company?",
    "Does this submit the filing?",
    "Are you going to register the company?",
    "Can this email the lawyer?",
    "file my company",
    "really file it",
  ]) {
    assert.equal(isFilingGuardQuestion(text), true, text);
  }
});

test("normal filing and summary questions are not the guard", () => {
  for (const text of [
    "What are the filing steps and fees?",
    "Prepare the lawyer summary",
    "Tick next step",
    "What is a section 85 rollover?",
    "Pick Mars",
  ]) {
    assert.equal(isFilingGuardQuestion(text), false, text);
  }
});

test("the local guard reply is an explicit no and names the demo boundary", () => {
  assert.match(FILING_GUARD_REPLY, /^No\b/);
  assert.match(FILING_GUARD_REPLY, /demo/i);
  assert.match(FILING_GUARD_REPLY, /nothing is filed/i);
  assert.match(FILING_GUARD_REPLY, /emailed/i);
  assert.match(FILING_GUARD_REPLY, /registry/i);
});

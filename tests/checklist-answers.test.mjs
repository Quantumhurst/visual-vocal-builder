// Checklist no-op tests — lib/checklist-answers.ts. "None of them" is a
// valid answer that changes no checklist state; it must be acknowledged
// from the real board instead of looking like a dead turn.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checklistNoopReply,
  isNothingDoneAnswer,
  isCompanyNameQuestion,
  companyNameReply,
  isNameApproval,
  isNameCancel,
} from "../lib/checklist-answers.ts";
import {
  applyChecklistItem,
  withDefaults,
} from "../lib/state-updates.ts";
import { CHECKLIST_PACK } from "../lib/knowledge.ts";

test("the quiet forms of 'none done' are recognized", () => {
  for (const text of [
    "zero",
    "0",
    "none",
    "None of them",
    "none so far",
    "nothing",
    "nothing yet",
    "nope",
    "not yet",
    "I haven't done any",
    "I have not finished anything",
    "zero checked",
  ]) {
    assert.equal(isNothingDoneAnswer(text), true, text);
  }
});

test("commands that merely start with no are left to the agent", () => {
  for (const text of [
    "no, tick the next one",
    "no — mark the first step done",
    "none of the articles are ready",
    "done",
    "",
    "zero the first one",
    "not yet, tick the name step",
    "tick off the first two checklist items",
  ]) {
    assert.equal(isNothingDoneAnswer(text), false, text);
  }
});

test("zero-done reply invites a starting step", () => {
  const reply = checklistNoopReply(withDefaults(null));
  assert.match(reply, /nothing checked yet/i);
  assert.match(reply, /start with/i);
});

test("partial-board reply reports the real count, not a model guess", () => {
  const base = withDefaults(null);
  let state = base;
  for (const fact of CHECKLIST_PACK.facts.slice(0, 2)) {
    state = applyChecklistItem(state, fact.factId, true);
  }
  const reply = checklistNoopReply(state);
  assert.match(reply, /2 of 5 checked/i);
  assert.match(reply, /tick the next one/i);
});

test("company name questions are recognized and answer names Galactic Bagels Inc.", () => {
  for (const text of [
    "What name did we pick?",
    "what is the company name",
    "what's our company name",
    "did we pick a name?",
    "tell me the name",
    "repeat the name",
    "what is the name",
    "what's our name",
    "verify company name",
  ]) {
    assert.equal(isCompanyNameQuestion(text), true, text);
  }
  assert.equal(isCompanyNameQuestion("Pick a company name"), false);
  assert.equal(isCompanyNameQuestion("tick next step"), false);
  assert.match(companyNameReply(), /Galactic Bagels Inc\. \(fictional\)/);
});

test("name approval and cancellation helpers identify responses", () => {
  for (const text of ["yes", "yeah", "sure", "approve", "Galactic Bagels", "use that name", "looks good", "lock it in"]) {
    assert.equal(isNameApproval(text), true, text);
  }
  for (const text of ["no", "cancel", "skip", "wait", "not yet", "go back"]) {
    assert.equal(isNameCancel(text), true, text);
  }
  assert.equal(isNameApproval("call it Cosmic Donuts"), false);
  assert.equal(isNameCancel("call it Cosmic Donuts"), false);
});

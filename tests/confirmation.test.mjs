// Confirmation answers for the equity gate.

import { test } from "node:test";
import assert from "node:assert/strict";
import { isConfirmationAnswer, isChangeAnswer } from "../lib/confirmation.ts";

test("short yes/confirm answers are confirmations", () => {
  for (const text of [
    "yes",
    "Yes,",
    "Yeah!",
    "yep",
    "confirm",
    "Confirmed.",
    "looks good",
    "that's right",
    "lock it in",
    "lock in the split",
    "OK",
    "yes please",
    "confirm the split",
    "confirm split",
    "confirm crew split",
    "split",
    "the split",
    "split confirmed",
    "confirm it",
    "confirm that",
    "move on",
    "let's move on",
    "confirm to move on",
    "yes, confirm",
    "that works",
    "done",
    "proceed",
    "agree",
  ]) {
    assert.equal(isConfirmationAnswer(text), true, text);
  }
});

test("change/no answers keep the card open", () => {
  for (const text of ["no", "No,", "nope", "change", "edit it", "not right", "wait", "go back"]) {
    assert.equal(isChangeAnswer(text), true, text);
  }
});

test("a confirmation with a new command is not a pure yes", () => {
  assert.equal(isConfirmationAnswer("yes, make it four owners"), false);
  assert.equal(isConfirmationAnswer("confirm and tick the next step"), false);
  assert.equal(isConfirmationAnswer(""), false);
  assert.equal(isChangeAnswer("no, make it four owners"), false);
});
test("an affirmative followed by a full confirm phrase is a confirmation", () => {
  for (const text of ["Yes, confirm the split.", "yes confirm the split", "Okay, confirm it", "yeah confirm this split"]) {
    assert.equal(isConfirmationAnswer(text), true, text);
  }
  assert.equal(isConfirmationAnswer("yes confirm the split and build"), false);
});

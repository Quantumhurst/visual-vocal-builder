import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CONTINUATION_GRACE_MS,
  looksUnfinishedTranscript,
  mergeContinuation,
} from "../lib/slow-speech.ts";

test("a mid-thought pause is held, not sent as the whole command", () => {
  for (const text of [
    "I would like to pick",
    "I want to",
    "The planet I want is",
    "The planet I want",
    "Maybe we should do",
    "Nova and",
    "The",
    "Pick",
    "Make",
    "I would like to pick,",
    "we need...",
  ]) {
    assert.equal(looksUnfinishedTranscript(text), true, text);
  }
});

test("complete commands, questions, and answers are never held", () => {
  for (const text of [
    "Pick Mars",
    "Make Nova 40 percent",
    "Four owners",
    "Yes",
    "No",
    "Confirm",
    "Stop",
    "Help",
    "How does the colony build work?",
    "What does the filing card say?",
    "Approve Galactic Bagels",
    "Prepare the lawyer summary",
    "Show transcript",
    "Start over",
    "Landing pad",
    "",
  ]) {
    assert.equal(looksUnfinishedTranscript(text), false, text);
  }
});

test("held text and the next final merge into one utterance", () => {
  assert.equal(
    mergeContinuation("I would like to pick", "Mars as our home base."),
    "I would like to pick Mars as our home base.",
  );
  assert.equal(mergeContinuation("Nova and", "Orbit split it"), "Nova and Orbit split it");
  // A doubled seam word is not repeated.
  assert.equal(mergeContinuation("I want to", "to pick Mars"), "I want to pick Mars");
  assert.equal(mergeContinuation("", "Pick Mars"), "Pick Mars");
  assert.equal(mergeContinuation("Pick", ""), "Pick");
});

test("the continuation grace is long enough for slow speech", () => {
  assert.ok(CONTINUATION_GRACE_MS >= 10_000);
});

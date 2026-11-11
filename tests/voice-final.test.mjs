import { test } from "node:test";
import assert from "node:assert/strict";
import { isStandaloneTurn, resolveVoiceFinal } from "../lib/voice-final.ts";

// The same decision runs on Meta streaming, the browser recogniser
// (Gemini) and buffered transcription, so these hold for every provider.

test("an unfinished first half is held", () => {
  for (const text of ["The planet I want is", "I would like to pick", "and then", "Pick"]) {
    assert.deepEqual(resolveVoiceFinal(text, null), { action: "hold", text }, text);
  }
});

test("the second half is merged with the held beginning and sent", () => {
  assert.deepEqual(resolveVoiceFinal("Mars as our home base", "The planet I want is"), {
    action: "send",
    text: "The planet I want is Mars as our home base",
  });
  assert.deepEqual(resolveVoiceFinal("Mars", "I would like to pick"), {
    action: "send",
    text: "I would like to pick Mars",
  });
});

test("a merged result that is still unfinished stays held", () => {
  const d = resolveVoiceFinal("we want", "For the company name");
  assert.equal(d.action, "hold");
  assert.equal(d.text, "For the company name we want");
});

test("standalone turns abandon the held words instead of being glued on", () => {
  for (const text of ["stop", "yes", "What is Europa?", "Approve Galactic Bagels"]) {
    const d = resolveVoiceFinal(text, "I want to");
    assert.equal(d.action, "send", text);
    assert.equal(d.text, text, text);
    assert.equal(isStandaloneTurn(text), true, text);
  }
});

test("complete commands and answers are sent without a hold", () => {
  for (const text of ["Pick Mars", "yes", "Make Nova 40 percent", "Prepare the lawyer summary"]) {
    assert.deepEqual(resolveVoiceFinal(text, null), { action: "send", text }, text);
  }
});

test("an empty held beginning is ignored", () => {
  assert.deepEqual(resolveVoiceFinal("Pick Mars", "  "), { action: "send", text: "Pick Mars" });
});

test("a punctuated spoken confirmation is sent, not held (Gemini adds punctuation)", () => {
  assert.deepEqual(resolveVoiceFinal("Yes, confirm the split.", null), { action: "send", text: "Yes, confirm the split." });
});

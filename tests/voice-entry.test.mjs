import { test } from "node:test";
import assert from "node:assert/strict";
import { entryHint, entryPrompt, parseEntryIntent } from "../lib/voice-entry.ts";

test("the obvious bridge phrases enter the app", () => {
  for (const text of [
    "Enter the bridge",
    "enter bridge",
    "Open the bridge",
    "Cross the bridge",
    "Enter the door",
    "Start",
    "Let's go",
    "Begin",
    "Hello",
    "Are you there",
  ]) {
    const intent = parseEntryIntent(text);
    assert.ok(intent, text);
    assert.equal(intent.mode, "resume", text);
  }
});

test("resume phrases continue a saved run", () => {
  for (const text of ["Resume", "Continue", "Pick up where I left off", "Carry on"]) {
    assert.equal(parseEntryIntent(text)?.mode, "resume", text);
  }
});

test("start over is the only phrase that clears a saved run", () => {
  for (const text of ["Start over", "Fresh start", "New colony", "From the beginning", "Reset"]) {
    assert.equal(parseEntryIntent(text)?.mode, "fresh", text);
  }
});

test("noise and non-entry questions do not cross the bridge", () => {
  for (const text of ["", "what is a tax question", "the weather", "no"]) {
    assert.equal(parseEntryIntent(text), null, text);
  }
});

test("the prompt tells the user exactly what to say", () => {
  assert.match(entryPrompt(false), /Enter the bridge/);
  assert.doesNotMatch(entryPrompt(false), /Resume/);
  assert.match(entryPrompt(true, "Step 3 of 6 — next: colony build"), /Resume/);
  assert.match(entryPrompt(true), /Start over/);
  assert.equal(entryHint(false), "SAY “ENTER THE BRIDGE”");
  assert.match(entryHint(true), /RESUME/);
});

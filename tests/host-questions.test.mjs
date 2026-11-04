import { test } from "node:test";
import assert from "node:assert/strict";
import { getHostQuestion, getLatestAssistantText, resolveHostPrompt, shouldSpeakFallbackQuestion } from "../lib/host-questions.ts";

// The glasses rule: one next step, one suggested phrase. Alternate
// commands still work by voice, but the host does not recite a menu.
test("jurisdiction fallback names one step and one phrase", () => {
  const q = getHostQuestion("jurisdiction");
  assert.match(q, /Pick Mars/);
  assert.match(q, /Say “Pick Mars”/);
  assert.doesNotMatch(q, /Europa, or Andromeda/);
});

test("equity fallback uses founder names and one suggested split", () => {
  const q = getHostQuestion("equity", ["Nova", "Orbit"]);
  assert.match(q, /Nova/);
  assert.match(q, /Orbit/);
  assert.match(q, /100% equity/);
  assert.match(q, /Make Orbit 70%/);
  assert.doesNotMatch(q, /or /);
});

test("checklist fallback is one yes, not a menu", () => {
  const q = getHostQuestion("checklist");
  assert.match(q, /one structure at a time/);
  assert.match(q, /Say “yes”/);
  assert.doesNotMatch(q, /tell me more/i);
});

test("name fallback asks for the exact approval only", () => {
  const q = getHostQuestion("name");
  assert.match(q, /Name the fictional company/);
  assert.match(q, /Approve Galactic Bagels/);
  assert.doesNotMatch(q, /Call it|5\/5|colony complete/i);
});

test("filingsteps fallback is optional and offers one way back", () => {
  const q = getHostQuestion("filingsteps");
  assert.match(q, /optional/i);
  assert.match(q, /continue/);
});
test("summary fallback", () => { assert.match(getHostQuestion("summary"), /Prepare the lawyer summary/); });

test("tool-call-only turn yields fallback, not empty box", () => {
  const msgs = [{ role: "assistant", content: "" }, { role: "assistant", content: [{ type: "tool-call", name: "x" }] }];
  assert.equal(getLatestAssistantText(msgs), null);
  const r = resolveHostPrompt(msgs, "checklist");
  assert.equal(r.source, "fallback"); assert.ok(r.text.length > 0);
});

test("assistant prose wins over fallback", () => {
  const r = resolveHostPrompt([{ role: "user", content: "hi" }, { role: "assistant", content: "Pick Mars?" }], "summary");
  assert.deepEqual(r, { text: "Pick Mars?", source: "agent" });
});

test("tool-only turn speaks the fallback question only when the beat advanced", () => {
  assert.equal(shouldSpeakFallbackQuestion("fallback", "jurisdiction", "equity"), true);
  assert.equal(shouldSpeakFallbackQuestion("fallback", "equity", "equity"), false);
  assert.equal(shouldSpeakFallbackQuestion("agent", "jurisdiction", "equity"), false);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { getHostQuestion, getLatestAssistantText, resolveHostPrompt, shouldSpeakFallbackQuestion } from "../lib/host-questions.ts";

test("jurisdiction fallback", () => { assert.match(getHostQuestion("jurisdiction"), /Mars, Europa, or Andromeda/); });
test("equity fallback uses founder names", () => { const q = getHostQuestion("equity", ["Nova", "Orbit"]); assert.match(q, /Nova/); assert.match(q, /Orbit/); assert.match(q, /100% equity/); });
test("checklist fallback", () => {
  assert.match(getHostQuestion("checklist"), /Build the next structure/);
  assert.match(getHostQuestion("checklist"), /Finish the build/);
});
test("name fallback asks for the exact approval", () => {
  assert.match(getHostQuestion("name"), /Approve Galactic Bagels/);
  assert.match(getHostQuestion("name"), /Call it/);
});
test("rollover fallback", () => { assert.match(getHostQuestion("rollover"), /Explain section 85/); });
test("filingsteps fallback is optional", () => { assert.match(getHostQuestion("filingsteps"), /optional/i); });
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

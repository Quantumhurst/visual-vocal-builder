import { test } from "node:test";
import assert from "node:assert/strict";
import { getHostQuestion, getLatestAssistantText, resolveHostPrompt } from "../lib/host-questions.ts";

test("jurisdiction fallback", () => { assert.match(getHostQuestion("jurisdiction"), /Mars, Europa, or Andromeda/); });
test("equity fallback uses founder names", () => { const q = getHostQuestion("equity", ["Nova", "Orbit"]); assert.match(q, /Nova/); assert.match(q, /Orbit/); assert.match(q, /100% equity/); });
test("checklist fallback", () => { assert.match(getHostQuestion("checklist"), /filing step/); });
test("rollover fallback", () => { assert.match(getHostQuestion("rollover"), /s\.85 rollover/); });
test("filingsteps fallback", () => { assert.match(getHostQuestion("filingsteps"), /filing steps and fees/); });
test("summary fallback", () => { assert.match(getHostQuestion("summary"), /lawyer summary package/); });
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

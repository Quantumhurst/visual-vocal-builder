import { test } from "node:test";
import assert from "node:assert/strict";
import { pushHistory, popHistory, statesEqual, HISTORY_CAP, COALESCE_MS } from "../lib/history.ts";
import { withDefaults, applyEquity } from "../lib/state-updates.ts";

const base = () => withDefaults(null);

test("push and pop round-trip", () => {
  const s0 = base();
  const s1 = applyEquity(s0, 1, 70, "test");
  const stack = pushHistory([], s0, "equity", 1000);
  assert.equal(stack.length, 1);
  const { stack: rest, entry } = popHistory(stack);
  assert.equal(rest.length, 0);
  assert.equal(entry.state.founders[0].percent, 60);
  assert.equal(s1.founders[1].percent, 70);
});

test("pop empty returns null entry", () => {
  const { entry } = popHistory([]);
  assert.equal(entry, null);
});

test("caps at HISTORY_CAP", () => {
  let stack = [];
  let s = base();
  for (let i = 0; i < HISTORY_CAP + 5; i++) {
    s = applyEquity(s, 0, 10 + i, "test");
    stack = pushHistory(stack, s, `step-${i}`, 1000 + i * (COALESCE_MS + 100));
  }
  assert.equal(stack.length, HISTORY_CAP);
});

test("same-label pushes within COALESCE_MS coalesce, keeping earliest", () => {
  const s0 = base();
  const s1 = applyEquity(s0, 0, 61, "test");
  let stack = pushHistory([], s0, "slider", 1000);
  stack = pushHistory(stack, s1, "slider", 1000 + COALESCE_MS - 1);
  assert.equal(stack.length, 1);
  assert.equal(stack[0].state.founders[0].percent, 60);
});

test("identical state (ignoring transcript) is skipped", () => {
  const s0 = base();
  let stack = pushHistory([], s0, "a", 1000);
  stack = pushHistory(stack, { ...s0, transcript: "hello" }, "b", 2000);
  assert.equal(stack.length, 1);
});

test("equityNote-only difference is equal: preview + agent confirm = one undo step", () => {
  const s0 = base();
  const preview = applyEquity(s0, 1, 70, "voice-live");
  const confirmed = applyEquity(s0, 1, 70, "voice");
  assert.notEqual(preview.equityNote, confirmed.equityNote);
  assert.ok(statesEqual(preview, confirmed));
  // Commit path: preview pushes the pre-change state; the confirming
  // commit must not push a second, note-only entry for undo to land on.
  let stack = pushHistory([], s0, "live-preview", 1000);
  assert.equal(stack.length, 1);
  const { entry } = popHistory(stack);
  assert.equal(entry.state.founders[1].percent, 40);
});

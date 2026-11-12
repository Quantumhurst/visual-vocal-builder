import { test } from "node:test";
import assert from "node:assert/strict";
import { createTurnStore } from "../lib/turn-store.ts";

test("turn store: dispatch applies at once and is readable synchronously", () => {
  const store = createTurnStore();
  assert.equal(store.get().hostSpeaking, false);
  store.dispatch({ type: "HOST_START" });
  assert.equal(store.get().hostSpeaking, true);
  store.dispatch({ type: "HOST_CANCEL" });
  assert.equal(store.get().hostSpeaking, false);
});

test("turn store: subscribers hear real changes only", () => {
  const store = createTurnStore();
  let calls = 0;
  const off = store.subscribe(() => {
    calls += 1;
  });
  store.dispatch({ type: "HOST_START" });
  store.dispatch({ type: "MIC_OPEN" }); // no change: the mic was not opening
  assert.equal(calls, 1);
  off();
  store.dispatch({ type: "HOST_END" });
  assert.equal(calls, 1);
});

test("turn store: an unchanged state keeps its identity, so React does not re-render", () => {
  const store = createTurnStore();
  const before = store.get();
  store.dispatch({ type: "HOLD_CLEAR" });
  assert.equal(store.get(), before);
});

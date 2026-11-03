import { test } from "node:test";
import assert from "node:assert/strict";
import { queueTurn, flushQueuedTurn, QUEUED_TURN_NOTICE } from "../lib/turn-queue.ts";

test("busy turn is queued, not sent; latest text wins; never more than one", () => {
  let slot = queueTurn(null, "first command", true);
  assert.deepEqual(slot, { text: "first command", convoWasActive: true });
  slot = queueTurn(slot, "second command", true);
  assert.deepEqual(slot, { text: "second command", convoWasActive: true });
  const held = flushQueuedTurn(slot, true, true);
  assert.equal(held.send, null);
  assert.deepEqual(held.slot, slot); // still parked while busy
});

test("idle flush sends the queued text exactly once", () => {
  const slot = queueTurn(null, "Make Orbit 70%", true);
  const first = flushQueuedTurn(slot, false, true);
  assert.equal(first.send, "Make Orbit 70%");
  assert.equal(first.slot, null);
  const second = flushQueuedTurn(first.slot, false, true);
  assert.equal(second.send, null);
  assert.equal(second.slot, null);
});

test("conversation ended -> queued text is dropped, never sent", () => {
  const slot = queueTurn(null, "Make Orbit 70%", true);
  const dropped = flushQueuedTurn(slot, false, false);
  assert.equal(dropped.send, null);
  assert.equal(dropped.slot, null);
});

test("manual single turn (no conversation) still flushes when idle", () => {
  const slot = queueTurn(null, "Pick Mars", false);
  const flushed = flushQueuedTurn(slot, false, false);
  assert.equal(flushed.send, "Pick Mars");
  assert.equal(flushed.slot, null);
});

test("queued notice tells the user the turn is parked", () => {
  assert.match(QUEUED_TURN_NOTICE, /queued/i);
});

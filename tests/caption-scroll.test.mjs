import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CAPTION_BOTTOM_THRESHOLD,
  countUserTurns,
  isNearBottom,
  shouldFollowAfterNewEntries,
} from "../lib/caption-scroll.ts";

test("near-bottom detection respects the threshold", () => {
  assert.equal(isNearBottom(0, 1000, 400, 24), false);
  assert.equal(isNearBottom(600, 1000, 400, 24), true);
  assert.equal(isNearBottom(575, 1000, 400, 24), false);
  assert.equal(isNearBottom(576, 1000, 400, CAPTION_BOTTOM_THRESHOLD), true);
  assert.equal(isNearBottom(0, 300, 400), true); // no scroll needed
});

test("user turns are counted separately from host lines", () => {
  const entries = [
    { role: "host" },
    { role: "you" },
    { role: "host" },
    { role: "you" },
  ];
  assert.equal(countUserTurns(entries), 2);
  assert.equal(countUserTurns([]), 0);
});

test("a host-only append keeps a reader parked; a new user turn follows", () => {
  assert.equal(shouldFollowAfterNewEntries(true, 2, 2), true);
  assert.equal(shouldFollowAfterNewEntries(false, 2, 2), false);
  assert.equal(shouldFollowAfterNewEntries(false, 3, 2), true);
  assert.equal(shouldFollowAfterNewEntries(false, 2, 3), false);
});

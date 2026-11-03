import { test } from "node:test";
import assert from "node:assert/strict";
import { LexicalEchoFilter } from "../lib/voice/echo-filter.ts";

test("LexicalEchoFilter: detects and tombstones acoustic self-echo from host speech", () => {
  const filter = new LexicalEchoFilter();
  filter.recordHostSpeech("Checking that now.");

  // User mic picks up speaker saying "checking that"
  const isEcho = filter.checkAndTombstone(101, "checking that");
  assert.equal(isEcho, true, "Should identify 'checking that' as self-echo");
  assert.equal(filter.isTurnIgnored(101), true, "Turn 101 must be ignored");

  // Subsequent events for turn 101 must be ignored
  assert.equal(filter.checkAndTombstone(101, "checking that now"), true);
});

test("LexicalEchoFilter: allows distinct user speech through", () => {
  const filter = new LexicalEchoFilter();
  filter.recordHostSpeech("Checking that now.");

  // User says "Pick Mars as our home base"
  const isEcho = filter.checkAndTombstone(102, "Pick Mars as our home base");
  assert.equal(isEcho, false, "Should not flag genuine user commands");
  assert.equal(filter.isTurnIgnored(102), false);
});

test("LexicalEchoFilter: clears tokens after speech finishes", async () => {
  const filter = new LexicalEchoFilter();
  filter.recordHostSpeech("On it.");
  filter.clear();

  // After clearing, user saying "On it" would not be treated as echo from an active speaker
  const isEcho = filter.checkAndTombstone(103, "On it");
  assert.equal(isEcho, false);
});


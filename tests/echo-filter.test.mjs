import { test } from "node:test";
import assert from "node:assert/strict";
import { LexicalEchoFilter } from "../lib/voice/echo-filter.ts";
import { equityConfirmationLine } from "../lib/build-host.ts";
import { withDefaults } from "../lib/state-updates.ts";

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

test("LexicalEchoFilter: a genuine short confirmation is not eaten by the host prompt", () => {
  const filter = new LexicalEchoFilter();
  const line = equityConfirmationLine(withDefaults(null));
  // The loop fix must stay strict, but the host must not speak the exact
  // words a user needs to say. Otherwise a real "confirm split" is 2/2 host
  // words and gets tombstoned as speaker bleed.
  assert.doesNotMatch(line, /\bconfirm\b/i);
  assert.doesNotMatch(line, /\bsplit\b/i);
  filter.recordHostSpeech(line);
  assert.equal(filter.checkAndTombstone(201, "confirm split"), false);
  assert.equal(filter.checkAndTombstone(202, "yes"), false);
  // A true tail of the host line is still caught.
  assert.equal(filter.checkAndTombstone(203, "pick a different owner count"), true);
});

test("LexicalEchoFilter: clears tokens after speech finishes", async () => {
  const filter = new LexicalEchoFilter();
  filter.recordHostSpeech("On it.");
  filter.clear();

  // After clearing, user saying "On it" would not be treated as echo from an active speaker
  const isEcho = filter.checkAndTombstone(103, "On it");
  assert.equal(isEcho, false);
});


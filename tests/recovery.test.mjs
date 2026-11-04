import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LISTENING_STALL_MS,
  RECOVERY_ESCALATE_AFTER,
  RecoveryTracker,
  isListeningStall,
  recoveryNotice,
} from "../lib/recovery.ts";

test("every recovery has a visible headline and exactly one next step", () => {
  for (const kind of [
    "turn-dropped",
    "empty-turn",
    "transcribe-failed",
    "agent-error",
    "agent-timeout",
    "host-silent",
    "stream-lost",
    "no-speech",
    "nothing-changed",
    "listening-stall",
  ]) {
    const notice = recoveryNotice(kind);
    assert.ok(notice.headline.length > 5, kind);
    assert.ok(notice.nextStep.length > 10, kind);
    assert.ok(["warn", "info"].includes(notice.tone), kind);
    assert.equal(notice.kind, kind);
  }
});

test("the silent-host recovery says the line is still on screen", () => {
  const notice = recoveryNotice("host-silent");
  assert.match(notice.headline, /silent/i);
  assert.match(notice.nextStep, /still on screen/i);
  assert.match(notice.nextStep, /test voice/i);
});

test("recovery keeps re-arming and escalates visibly, never silently", () => {
  const tracker = new RecoveryTracker();
  for (let i = 1; i < RECOVERY_ESCALATE_AFTER; i += 1) {
    const decision = tracker.record("agent-error");
    assert.equal(decision.rearm, true);
    assert.equal(decision.escalate, false);
    assert.equal(decision.attempts, i);
  }
  const escalated = tracker.record("agent-error", "upstream 503");
  assert.equal(escalated.rearm, true);
  assert.equal(escalated.escalate, true);
  assert.equal(escalated.notice.detail, "upstream 503");
  tracker.clear();
  assert.equal(tracker.count, 0);
});

test("a long audible turn with no words is a stall; a complete one is not", () => {
  assert.equal(
    isListeningStall({ recording: true, hasTranscript: false, heardAudio: true, listenedMs: LISTENING_STALL_MS }),
    true,
  );
  assert.equal(
    isListeningStall({ recording: true, hasTranscript: false, heardAudio: false, listenedMs: LISTENING_STALL_MS }),
    false,
  );
  assert.equal(
    isListeningStall({ recording: true, hasTranscript: true, heardAudio: true, listenedMs: 60_000 }),
    false,
  );
});

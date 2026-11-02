import { test } from "node:test";
import assert from "node:assert/strict";
import { clearedVoiceErrors, makeTranscribeFailure, hasRetryAudio, EMPTY_VOICE_ERRORS } from "../lib/voice-reliability.ts";

test("clearedVoiceErrors clears every displayed error and returns a fresh object", () => {
  const cleared = clearedVoiceErrors();
  assert.deepEqual(cleared, { turnError: "", transcribeFailure: null, notice: "" });
  assert.notEqual(cleared, EMPTY_VOICE_ERRORS);
  assert.deepEqual(clearedVoiceErrors(), cleared);
  assert.notEqual(clearedVoiceErrors(), cleared);
});

test("makeTranscribeFailure leads with plain language and keeps exact detail", () => {
  const failure = makeTranscribeFailure("ASR error: Audio processing backlog too large");
  assert.match(failure.plain, /Speech service busy/);
  assert.match(failure.plain, /your command was not heard/);
  assert.equal(failure.detail, "ASR error: Audio processing backlog too large");
});

test("makeTranscribeFailure falls back for empty detail", () => {
  assert.equal(makeTranscribeFailure("").detail, "unknown error");
  assert.equal(makeTranscribeFailure("   ").detail, "unknown error");
});

test("hasRetryAudio only when an in-memory buffer exists", () => {
  assert.equal(hasRetryAudio(null), false);
  assert.equal(hasRetryAudio(undefined), false);
  assert.equal(hasRetryAudio(new ArrayBuffer(0)), false);
  assert.equal(hasRetryAudio(new ArrayBuffer(4)), true);
});

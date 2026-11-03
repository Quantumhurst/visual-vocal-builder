import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clearedVoiceErrors,
  makeTranscribeFailure,
  hasRetryAudio,
  EMPTY_VOICE_ERRORS,
  ASR_TIMEOUT_MS,
  AGENT_WATCHDOG_MS,
  NO_SPEECH_TIMEOUT_MS,
  MAX_UTTERANCE_MS,
  SPEECH_POLL_TIMEOUT_MS,
  isEmptyTranscript,
  emptyTranscriptReply,
  noSpeechReply,
  shouldTriggerNoSpeech,
  shouldCapUtterance,
  shouldForceReArm,
} from "../lib/voice-reliability.ts";

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

test("voice reliability timeouts are bounded and non-hanging", () => {
  assert.equal(ASR_TIMEOUT_MS, 15_000);
  assert.equal(AGENT_WATCHDOG_MS, 25_000);
  assert.equal(NO_SPEECH_TIMEOUT_MS, 8_000);
  assert.equal(MAX_UTTERANCE_MS, 15_000);
  assert.equal(SPEECH_POLL_TIMEOUT_MS, 15_000);
});

test("empty transcript detection and friendly reply helper", () => {
  assert.equal(isEmptyTranscript(""), true);
  assert.equal(isEmptyTranscript("   \n\t  "), true);
  assert.equal(isEmptyTranscript(null), true);
  assert.equal(isEmptyTranscript(undefined), true);
  assert.equal(isEmptyTranscript("Mars"), false);
  assert.match(emptyTranscriptReply(), /Didn't catch that/i);
});

test("no-speech timeout and utterance cap guards", () => {
  assert.equal(shouldTriggerNoSpeech(false, 7_000), false);
  assert.equal(shouldTriggerNoSpeech(false, 8_000), true);
  assert.equal(shouldTriggerNoSpeech(false, 10_000), true);
  assert.equal(shouldTriggerNoSpeech(true, 10_000), false); // spoke: no timeout
  assert.match(noSpeechReply(), /Didn't hear anything/i);

  assert.equal(shouldCapUtterance(14_000), false);
  assert.equal(shouldCapUtterance(15_000), true);
  assert.equal(shouldCapUtterance(20_000), true);
});

test("speech synthesis re-arm force recovery", () => {
  assert.equal(shouldForceReArm(5_000), false);
  assert.equal(shouldForceReArm(14_900), false);
  assert.equal(shouldForceReArm(15_000), true);
  assert.equal(shouldForceReArm(45_000), true);
});

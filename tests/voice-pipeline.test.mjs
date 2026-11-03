import { test } from "node:test";
import assert from "node:assert/strict";
import { HybridEndpointer, normalizeTranscript } from "../lib/voice/hybrid-endpointer.ts";
import { StreamingSentenceChunker } from "../lib/voice/streaming-sentence-chunker.ts";

test("HybridEndpointer: normalizes raw transcript strings", () => {
  assert.equal(normalizeTranscript("  Confirm Split!!  "), "confirm split");
  assert.equal(normalizeTranscript("Yes, lock it in."), "yes lock it in");
  assert.equal(normalizeTranscript(""), "");
});

test("HybridEndpointer: fast-commits confirm split on stable partial + silence", () => {
  let committedTurn = null;
  let committedCmd = null;

  const endpointer = new HybridEndpointer(
    () => ({ equityConfirm: true, namePromptActive: false }),
    {
      stabilityMs: 200,
      silenceMs: 250,
      onFastCommit: (turnId, cmd) => {
        committedTurn = turnId;
        committedCmd = cmd;
      },
      onModelCommit: () => {
        assert.fail("Should not call onModelCommit for fast-committed command");
      },
    },
  );

  endpointer.handleMetaEvent({ type: "speechStart", turnId: 42 });
  assert.equal(endpointer.getActiveTurnId(), 42);

  // Partial arrives
  endpointer.handleMetaEvent({ type: "transcript", transcript: "confirm split" });
  assert.equal(committedTurn, null, "Should not commit instantly before stability/silence");

  // Advance time past stability + silence
  endpointer.onAudioRms(0.005, performance.now() + 500);

  assert.equal(committedTurn, 42);
  assert.equal(committedCmd?.kind, "CONFIRM_EQUITY");
  assert.equal(endpointer.isFastCommitted(42), true);

  // Late speechComplete from Meta arrives ~2 seconds later: must be ignored!
  endpointer.handleMetaEvent({ type: "speechComplete", turnId: 42, transcript: "Confirm split." });
  assert.equal(committedTurn, 42, "Must remain turn 42, not re-committed");
});

test("HybridEndpointer: non-fast command passes through to onModelCommit on speechComplete", () => {
  let modelTurn = null;
  let modelTranscript = null;

  const endpointer = new HybridEndpointer(
    () => ({ equityConfirm: true, namePromptActive: false }),
    {
      onFastCommit: () => {
        assert.fail("Should not fast-commit an open-ended question");
      },
      onModelCommit: (turnId, transcript) => {
        modelTurn = turnId;
        modelTranscript = transcript;
      },
    },
  );

  endpointer.handleMetaEvent({ type: "speechStart", turnId: 43 });
  endpointer.handleMetaEvent({ type: "transcript", transcript: "how does section 85 rollover work" });
  endpointer.handleMetaEvent({ type: "speechComplete", turnId: 43, transcript: "How does section 85 rollover work?" });

  assert.equal(modelTurn, 43);
  assert.equal(modelTranscript, "How does section 85 rollover work?");
});

test("StreamingSentenceChunker: chunks complete sentences and flushes remainder on end", () => {
  const chunker = new StreamingSentenceChunker();
  const sentences = [];

  chunker.onTextDelta("Welcome to Mars. We ", (s) => sentences.push(s));
  assert.deepEqual(sentences, ["Welcome to Mars."]);

  chunker.onTextDelta("have prepared five colony structures for you! Now ", (s) => sentences.push(s));
  assert.deepEqual(sentences, [
    "Welcome to Mars.",
    "We have prepared five colony structures for you!",
  ]);

  chunker.onTextMessageEnd((s) => sentences.push(s));
  assert.deepEqual(sentences, [
    "Welcome to Mars.",
    "We have prepared five colony structures for you!",
    "Now",
  ]);
});


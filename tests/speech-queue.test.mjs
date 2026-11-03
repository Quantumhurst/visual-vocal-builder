import { test, after } from "node:test";
import assert from "node:assert/strict";
import { SurvivingSpeechQueue } from "../lib/voice/surviving-speech-queue.ts";

const karen = { name: "Karen", lang: "en-AU", localService: true, voiceURI: "karen" };
const samantha = { name: "Samantha", lang: "en-US", localService: true, voiceURI: "samantha" };

class FakeUtterance {
  constructor(text) {
    this.text = text;
    this.voice = null;
    this.rate = 1;
    this.pitch = 1;
    this.onend = null;
    this.onerror = null;
  }
}

function installSynth(voices) {
  const spoken = [];
  const synth = {
    speaking: false,
    getVoices: () => voices,
    speak: (utterance) => {
      // Snapshot at the real speak() boundary: this is what browsers see.
      spoken.push({
        text: utterance.text,
        voice: utterance.voice?.name ?? null,
        pitch: utterance.pitch,
        rate: utterance.rate,
      });
    },
    cancel: () => {},
    resume: () => {},
  };
  globalThis.window = { speechSynthesis: synth };
  globalThis.SpeechSynthesisUtterance = FakeUtterance;
  return spoken;
}

after(() => {
  delete globalThis.window;
  delete globalThis.SpeechSynthesisUtterance;
});

test("SpeechQueue: curated voice, pitch, and rate are set before speak()", () => {
  const spoken = installSynth([karen]);
  const queue = new SurvivingSpeechQueue();

  queue.enqueue("This is your host voice.", {
    voice: karen,
    pitch: 1.08,
    rate: 1.04,
  });

  assert.deepEqual(spoken, [
    {
      text: "This is your host voice.",
      voice: "Karen",
      pitch: 1.08,
      rate: 1.04,
    },
  ]);
});

test("SpeechQueue: clearing the cached voice re-resolves the queue fallback", () => {
  const spoken = installSynth([samantha, karen]);
  const queue = new SurvivingSpeechQueue();

  assert.equal(queue.getVoice()?.name, "Samantha");
  // Cached: a later voice-list change does not replace it until cleared.
  globalThis.window.speechSynthesis.getVoices = () => [karen];
  assert.equal(queue.getVoice()?.name, "Samantha");

  queue.clearCachedVoice();
  assert.equal(queue.getVoice()?.name, "Karen");

  // The explicit caller voice still wins over the fallback cache.
  queue.enqueue("Hi", { voice: samantha });
  assert.equal(spoken.at(-1)?.voice, "Samantha");
});

test("SpeechQueue: onError fires before the single onDone cleanup", () => {
  installSynth([karen]);
  const queue = new SurvivingSpeechQueue();
  const events = [];

  const utterance = queue.enqueue("Host line", {
    voice: karen,
    onError: () => events.push("error"),
    onDone: () => events.push("done"),
  });

  utterance.onerror({ error: "synthesis-failed" });
  utterance.onerror({ error: "synthesis-failed" });
  assert.deepEqual(events, ["error", "done"]);
});

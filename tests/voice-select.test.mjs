import { test } from "node:test";
import assert from "node:assert/strict";
import { voiceScore, rankVoices, pickVoice, prosodyFor } from "../lib/voice-select.ts";

const V = (name, lang = "en-US", extra = {}) => ({ name, lang, ...extra });

test("enhanced and natural voices outrank defaults and novelty", () => {
  const voices = [
    V("Fred"),
    V("Samantha"),
    V("Google US English", "en-US", { localService: false }),
    V("Ava (Premium)"),
    V("Microsoft Aria Online (Natural)"),
    V("Albert"),
    V("Amélie", "fr-CA"),
  ];
  const ranked = rankVoices(voices);
  assert.equal(ranked[0].name, "Ava (Premium)");
  assert.ok(voiceScore(V("Ava (Premium)")) > voiceScore(V("Samantha")));
  assert.ok(voiceScore(V("Samantha")) > voiceScore(V("Fred")));
  assert.equal(pickVoice(voices).name, "Ava (Premium)");
  assert.ok(!ranked.some((v) => v.lang === "fr-CA"));
});

test("novelty-only lists yield no pick", () => {
  assert.equal(pickVoice([V("Albert"), V("Zarvox")]), null);
  assert.equal(pickVoice([]), null);
});

test("questions get a small lift, statements stay neutral", () => {
  assert.deepEqual(prosodyFor("Shall we split the equity?"), { rate: 1.04, pitch: 1.08 });
  assert.deepEqual(prosodyFor("Mars is locked in."), { rate: 1.0, pitch: 1.0 });
});

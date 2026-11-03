import { test } from "node:test";
import assert from "node:assert/strict";
import {
  voiceScore,
  rankVoices,
  pickVoice,
  prosodyFor,
  resolveVoiceSelection,
  selectableVoices,
} from "../lib/voice-select.ts";

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

test("a saved voiceURI selects that exact voice", () => {
  const voices = [
    V("Ava (Premium)", "en-US", { voiceURI: "ava" }),
    V("Samantha", "en-US", { voiceURI: "samantha" }),
    V("Amélie", "fr-CA", { voiceURI: "amelie" }),
  ];
  assert.equal(resolveVoiceSelection(voices, "samantha")?.name, "Samantha");
  assert.equal(resolveVoiceSelection(voices, "ava")?.name, "Ava (Premium)");
});

test("missing, novelty, or ineligible saved voices fall back to the automatic pick", () => {
  const voices = [
    V("Ava (Premium)", "en-US", { voiceURI: "ava" }),
    V("Samantha", "en-US", { voiceURI: "samantha" }),
    V("Rocko (English (United States))", "en-US", { voiceURI: "rocko" }),
    V("Fred", "en-US", { voiceURI: "fred" }),
    V("Amélie", "fr-CA", { voiceURI: "amelie" }),
  ];
  // Stale URI after an OS/browser update.
  assert.equal(resolveVoiceSelection(voices, "gone")?.name, "Ava (Premium)");
  // A non-English voice is not used for the English host line.
  assert.equal(resolveVoiceSelection(voices, "amelie")?.name, "Ava (Premium)");
  // Novelty/character voices are filtered out even when explicitly saved.
  assert.equal(resolveVoiceSelection(voices, "rocko")?.name, "Ava (Premium)");
  assert.equal(resolveVoiceSelection(voices, "fred")?.name, "Ava (Premium)");
  assert.equal(resolveVoiceSelection(voices, "auto")?.name, "Ava (Premium)");
  assert.equal(resolveVoiceSelection(voices, null)?.name, "Ava (Premium)");
});

test("selectableVoices hides novelty/character voices but keeps usable English voices", () => {
  const voices = [
    V("Samantha"),
    V("Rocko (English (United States))"),
    V("Fred"),
    V("Ava (Premium)"),
    V("Amélie", "fr-CA"),
  ];
  assert.deepEqual(
    selectableVoices(voices).map((voice) => voice.name),
    ["Ava (Premium)", "Samantha"],
  );
});

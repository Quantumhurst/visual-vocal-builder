import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseLiveIntent,
  rmsLevel,
  nextVoiceActivity,
  shouldAutoStop,
  IDLE_ACTIVITY,
  SILENCE_TO_STOP_MS,
  INTENT_SILENCE_TO_STOP_MS,
} from "../lib/live-intent.ts";
import { BRAIN_MODEL, ASR_MODEL, ASR_KEYWORDS, buildAsrHandshake } from "../lib/meta-models.ts";

test("pick mars -> jurisdiction intent, instantly recognisable mid-sentence", () => {
  const i = parseLiveIntent("pick Mars");
  assert.equal(i.kind, "jurisdiction");
  assert.equal(i.jurisdiction, "Mars");
  assert.equal(parseLiveIntent("Pick Mars as our home base").jurisdiction, "Mars");
  assert.equal(parseLiveIntent("let's go with europa please").jurisdiction, "Europa");
  assert.equal(parseLiveIntent("andromeda galaxy").jurisdiction, "Andromeda Galaxy");
});

test("naming two planets is a comparison, not a pick -> no speculative intent", () => {
  assert.equal(parseLiveIntent("compare Mars and Europa"), null);
  assert.equal(parseLiveIntent("what is the weather like"), null);
  assert.equal(parseLiveIntent(""), null);
  assert.equal(parseLiveIntent("   "), null);
});

test("equity intents in either word order", () => {
  const a = parseLiveIntent("make Orbit 70%");
  assert.equal(a.kind, "equity"); assert.equal(a.founder, "orbit"); assert.equal(a.percent, 70);
  const b = parseLiveIntent("make me 70%");
  assert.equal(b.kind, "equity"); assert.equal(b.founder, "me"); assert.equal(b.percent, 70);
  const c = parseLiveIntent("set Nova to 30 percent");
  assert.equal(c.kind, "equity"); assert.equal(c.percent, 30);
  assert.equal(parseLiveIntent("make Orbit bigger"), null);
  assert.equal(parseLiveIntent("make Orbit 170%"), null);
});

test("checklist, lawyer and grounded-question intents", () => {
  assert.equal(parseLiveIntent("next step please").kind, "checklist-advance");
  assert.equal(parseLiveIntent("mark that done").kind, "checklist-advance");
  assert.equal(parseLiveIntent("yes"), null); // bare yes never moves state
  assert.equal(parseLiveIntent("prepare the lawyer summary").kind, "lawyer-summary");
  assert.equal(parseLiveIntent("what is a section 85 rollover?").kind, "rollover-question");
  assert.equal(parseLiveIntent("what are the filing steps and fees?").kind, "filing-question");
});

test("rmsLevel: silence is 0, speech is well above the threshold", () => {
  assert.equal(rmsLevel(new Float32Array(128)), 0);
  const loud = new Float32Array(128).fill(0.2);
  assert.ok(rmsLevel(loud) > 0.15);
  assert.equal(rmsLevel(new Float32Array(0)), 0);
});

test("auto-stop only after real speech plus a real pause", () => {
  const t0 = 10_000;
  let a = nextVoiceActivity(IDLE_ACTIVITY, 0.001, t0, 100); // silence only
  assert.equal(shouldAutoStop(a, t0 + 60_000), false);
  a = nextVoiceActivity(a, 0.2, t0, 200);
  a = nextVoiceActivity(a, 0.2, t0 + 200, 200); // 400ms of speech
  assert.equal(a.hasSpoken, true);
  assert.equal(shouldAutoStop(a, t0 + 400 + 400), false); // brief pause: keep listening
  assert.equal(shouldAutoStop(a, t0 + 400 + 1200), true); // natural pause: send it
});

test("adaptive endpointing: intent-matched stops at 600ms, unmatched waits for 1100ms", () => {
  assert.equal(SILENCE_TO_STOP_MS, 1100);
  assert.equal(INTENT_SILENCE_TO_STOP_MS, 600);
  const t0 = 20_000;
  let a = nextVoiceActivity(IDLE_ACTIVITY, 0.2, t0, 200);
  a = nextVoiceActivity(a, 0.2, t0 + 200, 200); // 400ms of speech
  const silence600 = t0 + 200 + 600;
  assert.equal(shouldAutoStop(a, silence600, INTENT_SILENCE_TO_STOP_MS), true);
  assert.equal(shouldAutoStop(a, silence600, SILENCE_TO_STOP_MS), false);
  assert.equal(shouldAutoStop(a, silence600), false); // default is the full pause
  assert.equal(shouldAutoStop(a, t0 + 200 + 1100, SILENCE_TO_STOP_MS), true);
});

test("adaptive endpointing: speech under 350ms never stops, even intent-matched", () => {
  const t0 = 30_000;
  const a = nextVoiceActivity(IDLE_ACTIVITY, 0.2, t0, 200); // 200ms only
  assert.equal(shouldAutoStop(a, t0 + 60_000, INTENT_SILENCE_TO_STOP_MS), false);
  assert.equal(shouldAutoStop(a, t0 + 60_000, SILENCE_TO_STOP_MS), false);
});

test("meta model config: best-fit models + ASR biasing handshake", () => {
  assert.equal(BRAIN_MODEL, "muse-spark-1.3");
  assert.equal(ASR_MODEL, "muse-voice-transcribe-1.0");
  const hs = buildAsrHandshake("KEY");
  assert.equal(hs.model, "muse-voice-transcribe-1.0");
  assert.equal(hs.mode, "ENDPOINTING");
  assert.equal(hs.partialMode, "CUMULATIVE");
  assert.equal(hs.authorization.accessToken, "Bearer KEY");
  for (const w of ["Mars", "Europa", "Andromeda Galaxy", "section 85"]) assert.ok(hs.keywords.includes(w), w);
  for (const w of ["three owners", "five people", "founders", "Vega", "confirm", "tick next step", "zero"]) {
    assert.ok(hs.keywords.includes(w), w);
  }
  assert.deepEqual(hs.languageBias, ["English"]);
  assert.ok(ASR_KEYWORDS.length >= 30);
});

test("owner-count intents cover solo and 1-5 owners", () => {
  const solo = parseLiveIntent("it's just me");
  assert.equal(solo.kind, "owner-count");
  assert.equal(solo.count, 1);
  assert.equal(parseLiveIntent("there are three of us").count, 3);
  assert.equal(parseLiveIntent("we're five founders").count, 5);
  assert.equal(parseLiveIntent("four owners").count, 4);
});

test("checklist counts: first two, next step, all", () => {
  const two = parseLiveIntent("tick off the first two checklist items");
  assert.equal(two.kind, "checklist-advance");
  assert.equal(two.count, 2);
  const one = parseLiveIntent("mark the next checklist step done");
  assert.equal(one.count, 1);
  const all = parseLiveIntent("finish the build");
  assert.equal(all.kind, "checklist-advance");
  assert.equal(all.count, "all");
  const finish = parseLiveIntent("tick off every remaining checklist item");
  assert.equal(finish.count, "all");
  // A named step must go to the agent, not tick the first thing blindly.
  assert.equal(parseLiveIntent("tick the name step"), null);
});

test("new owner names are recognised for equity", () => {
  const vega = parseLiveIntent("make Vega 20%");
  assert.equal(vega.kind, "equity");
  assert.equal(vega.founder, "vega");
  assert.equal(vega.percent, 20);
});

test("undo, start over, and cheapest are local deterministic intents", () => {
  assert.equal(parseLiveIntent("Actually, undo that").kind, "undo");
  assert.equal(parseLiveIntent("take that back").kind, "undo");
  assert.equal(parseLiveIntent("start over").kind, "start-over");
  assert.equal(parseLiveIntent("fresh start").kind, "start-over");
  assert.equal(parseLiveIntent("what's the cheapest place?").kind, "cheapest");
  assert.equal(parseLiveIntent("lowest fee").kind, "cheapest");
  // Navigation language must not be mistaken for an undo.
  assert.equal(parseLiveIntent("go back to the build queue"), null);
});

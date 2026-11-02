import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseLiveIntent,
  rmsLevel,
  nextVoiceActivity,
  shouldAutoStop,
  IDLE_ACTIVITY,
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

test("meta model config: best-fit models + ASR biasing handshake", () => {
  assert.equal(BRAIN_MODEL, "muse-spark-1.3");
  assert.equal(ASR_MODEL, "muse-voice-transcribe-1.0");
  const hs = buildAsrHandshake("KEY");
  assert.equal(hs.model, "muse-voice-transcribe-1.0");
  assert.equal(hs.mode, "ENDPOINTING");
  assert.equal(hs.partialMode, "CUMULATIVE");
  assert.equal(hs.authorization.accessToken, "Bearer KEY");
  for (const w of ["Mars", "Europa", "Andromeda Galaxy", "section 85"]) assert.ok(hs.keywords.includes(w), w);
  assert.deepEqual(hs.languageBias, ["English"]);
  assert.ok(ASR_KEYWORDS.length >= 8);
});

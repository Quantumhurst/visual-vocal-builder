// Landing-gate wiring: same route, voice-first entry, cockpit only after
// the voice (or the visible fallback) crosses the bridge.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const gate = readFileSync(new URL("../components/LandingGate.tsx", import.meta.url), "utf8");
const entry = readFileSync(new URL("../components/VoiceEntry.tsx", import.meta.url), "utf8");
const canvas = readFileSync(new URL("../components/Canvas.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

test("the same page now renders the persistent landing gate", () => {
  assert.match(page, /LandingGate/);
  assert.doesNotMatch(page, /Suspense/);
  assert.doesNotMatch(page, /Booting the bridge/);
});

test("the landing is voice-first, with the button only as a fallback", () => {
  assert.match(entry, /boot-orbit/);
  assert.match(entry, /VVB-01 · ORBITAL FOUNDRY/);
  assert.match(entry, /Build a colony by voice\. Never touch a mouse\./);
  assert.match(entry, /Demo data only\. This is not legal advice, not a filing/);
  assert.match(entry, /submitted to any\s+registry/);
  assert.match(entry, /data-testid="voice-gate"/);
  assert.match(entry, /parseEntryIntent/);
  assert.match(entry, /getUserMedia/);
  assert.match(entry, /data-testid="enter-bridge"/);
  assert.match(entry, /Enter the Bridge/);
});

test("crossing the bridge auto-starts the cockpit conversation", () => {
  assert.match(gate, /<CanvasHost/);
  assert.match(gate, /autoStart/);
  assert.match(gate, /resumed/);
  assert.match(gate, /initialState/);
  assert.match(canvas, /function Canvas\(\{ autoStart/);
  assert.match(canvas, /Voice-first boot: the cockpit opens the conversation/);
  assert.match(canvas, /void startRecording\(\)/);
  assert.match(canvas, /resumeSummary\(/);
});

test("the landing orb has a contained spin ring, not a full-page overlay", () => {
  assert.match(entry, /landing-orb-wrap/);
  assert.match(entry, /landing-spin/);
  assert.match(entry, /<div className="landing-orb-wrap" aria-hidden="true">/);
  const wrapBlock = css.match(/\.landing-orb-wrap\s*\{([^}]*)\}/s)?.[1] ?? "";
  const spinBlock = css.match(/\.landing-spin\s*\{([^}]*)\}/s)?.[1] ?? "";
  assert.match(wrapBlock, /position: relative/);
  assert.match(spinBlock, /position: absolute/);
  assert.doesNotMatch(spinBlock, /position: fixed/);
  assert.match(spinBlock, /animation: orbit/);
});

test("the landing disclaimer and controls meet the large-type contrast pass", () => {
  assert.match(css, /\.landing-screen \.landing-disclaimer\s*\{[^}]*font-size:\s*14px/s);
  assert.match(css, /\.voice-gate-status\s*\{[^}]*font-size:\s*17px/s);
  assert.match(css, /\.landing-enter\s*\{[^}]*min-height:\s*52px/s);
});

// Landing-gate wiring: same route, one button, cockpit only after Enter.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const gate = readFileSync(new URL("../components/LandingGate.tsx", import.meta.url), "utf8");
const canvas = readFileSync(new URL("../components/Canvas.tsx", import.meta.url), "utf8");

test("the same page now renders the persistent landing gate", () => {
  assert.match(page, /LandingGate/);
  assert.doesNotMatch(page, /Suspense/);
  assert.doesNotMatch(page, /Booting the bridge/);
});

test("the landing keeps the orb, tagline, disclaimer, and exactly one button", () => {
  assert.match(gate, /boot-orbit/);
  assert.match(gate, /VVB-01 · ORBITAL FOUNDRY/);
  assert.match(gate, /Incorporate a company by voice/);
  assert.match(gate, /Demo data only\. This is not legal advice, not a filing, and nothing here is/);
  assert.match(gate, /submitted to any registry/);
  assert.match(gate, /data-testid="enter-bridge"/);
  assert.match(gate, />\s*Enter the Bridge\s*</);
  assert.equal((gate.match(/<button/g) ?? []).length, 1);
});

test("Enter mounts the cockpit with autoStart", () => {
  assert.match(gate, /CanvasHost autoStart/);
  assert.match(canvas, /function Canvas\(\{ autoStart = false \}/);
  assert.match(canvas, /toggleRecordingRef\.current\(true\)/);
  assert.match(canvas, /forceGreeting/);
  assert.match(canvas, /consumeFirstSpeakGreeting\(\)/);
});

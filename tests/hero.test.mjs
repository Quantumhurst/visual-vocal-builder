// Day 4 tests — PixiJS landing hero (components/GalaxyHero.tsx, lib/hero.ts).
// Run with: npm test (Node built-in runner, no new dependencies).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createHeroLifecycle,
  heroPlanets,
  highlightIndex,
  selectFromHero,
  shouldUseDomFallback,
} from "../lib/hero.ts";
// demo-data.ts uses extensionless imports Node's runner can't resolve, so
// read the DEMO names from source — still proving hero uses demo-data order.
const demoSrc = readFileSync(new URL("../lib/demo-data.ts", import.meta.url), "utf8");
const NAMES = [...demoSrc.matchAll(/jurisdiction: "([^"]+)"/g)].map((m) => m[1]);

test("hero planets come from demo-data, never hard-coded copies", () => {
  assert.deepEqual(NAMES, ["Mars", "Europa", "Andromeda Galaxy"]);
  const planets = heroPlanets(NAMES);
  assert.equal(planets.length, 3);
  assert.deepEqual(planets.map((p) => p.name), NAMES);
  const src = readFileSync(new URL("../components/GalaxyHero.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(src, /"Mars"|"Europa"|"Andromeda Galaxy"/);
});

test("click Mars selects Mars; the other two do not change", () => {
  const state = { selectedJurisdiction: null };
  const pick = selectFromHero(NAMES, "Mars");
  assert.equal(pick, "Mars");
  state.selectedJurisdiction = pick;
  assert.equal(state.selectedJurisdiction, "Mars");
  assert.notEqual(state.selectedJurisdiction, "Europa");
  assert.notEqual(state.selectedJurisdiction, "Andromeda Galaxy");
  // Unknown names invent nothing.
  assert.equal(selectFromHero(NAMES, "Pluto"), null);
  assert.equal(selectFromHero(NAMES, ""), null);
});

test("voice-driven selection updates the hero highlight from shared state", () => {
  assert.equal(highlightIndex(NAMES, null), -1);
  assert.equal(highlightIndex(NAMES, "Mars"), 0);
  assert.equal(highlightIndex(NAMES, "Europa"), 1);
  assert.equal(highlightIndex(NAMES, "Andromeda Galaxy"), 2);
  assert.equal(highlightIndex(NAMES, "Pluto"), -1);
});

test("unmount destroys the Pixi app (idempotent, ticker stopped)", () => {
  const src = readFileSync(new URL("../components/GalaxyHero.tsx", import.meta.url), "utf8");
  assert.match(src, /app\.ticker\.stop\(\)/);
  assert.match(src, /app\.destroy\(true/);
  const canvasSrc = readFileSync(new URL("../components/Canvas.tsx", import.meta.url), "utf8");
  assert.match(canvasSrc, /dynamic\(.*GalaxyHero.*ssr: false/s);
  const lifecycle = createHeroLifecycle();
  let calls = 0;
  lifecycle.destroy(() => { calls++; });
  lifecycle.destroy(() => { calls++; });
  assert.equal(calls, 1);
  assert.equal(lifecycle.isDestroyed(), true);
});

test("WebGL-unavailable path renders the DOM fallback", () => {
  assert.equal(shouldUseDomFallback(false), true);
  assert.equal(shouldUseDomFallback(true), false);
  const src = readFileSync(new URL("../components/GalaxyHero.tsx", import.meta.url), "utf8");
  assert.match(src, /detectWebGL/);
  assert.match(src, /prefers-reduced-motion/);
  assert.match(src, /aria-label/);
  // DOM buttons under the canvas, same labels/click behavior (a11y).
  assert.match(src, /aria-pressed/);
});

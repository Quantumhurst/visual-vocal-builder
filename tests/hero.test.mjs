// Day 4 tests — PixiJS landing hero (components/GalaxyHero.tsx, lib/hero.ts).
// Run with: npm test (Node built-in runner, no new dependencies).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  burstRing,
  createHeroLifecycle,
  heroPlanets,
  highlightIndex,
  pulseRing,
  selectFromHero,
  shouldUseDomFallback,
  starfieldPoints,
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

test("starfield is seeded, in-bounds, layered, and not the old diagonal formula", () => {
  const W = 860, H = 320;
  const a = starfieldPoints(W, H, 140, 1337);
  const b = starfieldPoints(W, H, 140, 1337);
  assert.deepEqual(a, b); // stable across renders
  assert.equal(a.length, 140);
  for (const s of a) {
    assert.ok(s.x >= 0 && s.x < W && s.y >= 0 && s.y < H, "in bounds");
    assert.ok(s.r > 0 && s.alpha > 0 && s.alpha <= 1);
    assert.ok(s.layer === 0 || s.layer === 1);
  }
  assert.ok(a.some((s) => s.layer === 0) && a.some((s) => s.layer === 1), "two layers");
  const far = a.filter((s) => s.layer === 0), near = a.filter((s) => s.layer === 1);
  assert.ok(Math.max(...far.map((s) => s.speed)) < Math.min(...near.map((s) => s.speed)), "far drifts slower");
  // Not the old (i*613)%W,(i*389)%H dotted diagonal rows.
  const old = Array.from({ length: 140 }, (_, i) => ({ x: (i * 613) % W, y: (i * 389) % H }));
  assert.notDeepEqual(a.map(({ x, y }) => ({ x, y })), old);
  assert.ok(new Set(a.map((s) => Math.round(s.x))).size > 100, "x not on a sparse diagonal lattice");
  // Not collinear: correlation between x and y is weak.
  const mx = a.reduce((t, s) => t + s.x, 0) / a.length, my = a.reduce((t, s) => t + s.y, 0) / a.length;
  const cov = a.reduce((t, s) => t + (s.x - mx) * (s.y - my), 0);
  const vx = a.reduce((t, s) => t + (s.x - mx) ** 2, 0), vy = a.reduce((t, s) => t + (s.y - my) ** 2, 0);
  assert.ok(Math.abs(cov / Math.sqrt(vx * vy)) < 0.2, "not collinear");
});

test("pulse and burst rings expand and fade, and burst ends", () => {
  const p0 = pulseRing(44, 0), p1 = pulseRing(44, 900);
  assert.ok(p0.radius >= 44 && p1.radius >= 44 && p0.alpha >= 0 && p0.alpha <= 1);
  const b0 = burstRing(44, 0), bMid = burstRing(44, 300), bDone = burstRing(44, 600);
  assert.ok(b0 && bMid && bMid.radius > b0.radius && bMid.alpha < b0.alpha, "expands and fades");
  assert.equal(bDone, null);
  assert.equal(burstRing(44, -1), null);
  const src = readFileSync(new URL("../components/GalaxyHero.tsx", import.meta.url), "utf8");
  assert.match(src, /Mission 1: pick your home base/);
  assert.match(src, /prefers-reduced-motion/);
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

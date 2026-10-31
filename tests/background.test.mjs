// Starfield background tests — full-viewport backdrop behind the
// centered column (components/StarfieldBackground.tsx). It reuses the
// seeded starfield from lib/hero.ts, reads/writes no shared state, and
// honors prefers-reduced-motion with a static draw.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { starfieldPoints } from "../lib/hero.ts";

test("background reuses the seeded starfield and covers the viewport", () => {
  const stars = starfieldPoints(1920, 1080, 180, 2027);
  assert.equal(stars.length, 180);
  assert.deepEqual(stars, starfieldPoints(1920, 1080, 180, 2027)); // seeded, stable
  // Stars land across the full width, so both page margins get stars
  // on a wide screen with the 900px column centered.
  assert.ok(stars.some((s) => s.x < 300), "left margin has stars");
  assert.ok(stars.some((s) => s.x > 1620), "right margin has stars");
  assert.ok(stars.every((s) => s.x >= 0 && s.x < 1920 && s.y >= 0 && s.y < 1080));
});

test("background component is fixed, behind content, static under reduced motion", () => {
  const src = readFileSync(new URL("../components/StarfieldBackground.tsx", import.meta.url), "utf8");
  assert.match(src, /starfieldPoints/);
  assert.match(src, /position: "fixed"/);
  assert.match(src, /zIndex: -1/);
  assert.match(src, /pointerEvents: "none"/);
  assert.match(src, /aria-hidden="true"/);
  assert.match(src, /prefers-reduced-motion: reduce/);
  // Reduced motion draws once and never starts the loop on that path.
  assert.match(src, /if \(reduced\) \{\s*draw\(0\);/);
  // Pure backdrop: no shared state, no agent, no Pixi.
  assert.doesNotMatch(src, /useCoAgent|useCopilotAction|setState|pixi/i);
  const layoutSrc = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
  assert.match(layoutSrc, /StarfieldBackground/);
});

// Cockpit brand gets the same contained orbital spin as the landing orb.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const canvas = readFileSync(new URL("../components/Canvas.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

test("the HUD brand has a contained spin ring", () => {
  assert.match(canvas, /<span className="brand-orb-wrap" aria-hidden="true">/);
  assert.match(canvas, /<span className="brand-spin" \/>/);
  assert.match(canvas, /<span className="brand-mark">/);
  assert.match(canvas, /<div className="brand-text">/);
  const wrapBlock = css.match(/\.brand-orb-wrap\s*\{([^}]*)\}/s)?.[1] ?? "";
  const spinBlock = css.match(/\.brand-spin\s*\{([^}]*)\}/s)?.[1] ?? "";
  assert.match(wrapBlock, /position: relative/);
  assert.match(spinBlock, /position: absolute/);
  assert.doesNotMatch(spinBlock, /position: fixed/);
  assert.match(spinBlock, /animation: orbit/);
});

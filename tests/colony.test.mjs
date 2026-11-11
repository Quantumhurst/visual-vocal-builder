// Day 8 tests — colony board (components/ColonyView.tsx, lib/colony.ts).
// Run with: npm test (Node built-in runner, no new dependencies).
//
// The colony reads shared state only: checklist ticks build structures,
// the equity split moves the crew-quarters wall, and the prepared
// lawyer package launches the rocket. These tests pin that mapping.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  colonyPalette,
  colonyProgress,
  colonyStructures,
  crewQuarters,
  launchFrame,
  launchState,
} from "../lib/colony.ts";
import { CHECKLIST_PACK } from "../lib/knowledge.ts";

const checklist = (doneIds = []) =>
  CHECKLIST_PACK.facts.map((fact) => ({
    id: fact.factId,
    label: fact.topic,
    guidance: fact.text,
    done: doneIds.includes(fact.factId),
  }));

test("every checklist item maps to a structure; done items are built", () => {
  const none = colonyStructures(checklist());
  assert.equal(none.length, CHECKLIST_PACK.facts.length);
  assert.ok(none.every((s) => !s.built));
  assert.deepEqual(
    none.map((s) => s.kind),
    ["landingPad", "dome", "solarArray", "crewQuarters", "bagelFactory"],
  );
  const some = colonyStructures(checklist(["build-landing-pad", "build-crew-quarters"]));
  assert.equal(some.find((s) => s.kind === "landingPad").built, true);
  assert.equal(some.find((s) => s.kind === "crewQuarters").built, true);
  assert.equal(some.find((s) => s.kind === "dome").built, false);
  // Unknown checklist ids never break the board.
  const extra = colonyStructures([{ id: "check-new-thing", label: "New thing", guidance: "x", done: true }]);
  assert.equal(extra.length, 1);
  assert.equal(extra[0].built, true);
});

test("colony progress counts built structures", () => {
  assert.deepEqual(colonyProgress(checklist()), { built: 0, total: 5, percent: 0 });
  const all = CHECKLIST_PACK.facts.map((f) => f.factId);
  assert.deepEqual(colonyProgress(checklist(all)), { built: 5, total: 5, percent: 100 });
  assert.deepEqual(colonyProgress([]), { built: 0, total: 0, percent: 0 });
});

test("crew quarters widths follow the equity split and total the building", () => {
  const founders = [
    { name: "DEMO Founder Nova (fictional)", percent: 60 },
    { name: "DEMO Founder Orbit (fictional)", percent: 40 },
  ];
  const q = crewQuarters(founders);
  assert.equal(q.length, 2);
  assert.ok(Math.abs(q[0].widthFraction - 0.6) < 1e-9);
  assert.ok(Math.abs(q[1].widthFraction - 0.4) < 1e-9);
  assert.ok(Math.abs(q.reduce((s, x) => s + x.widthFraction, 0) - 1) < 1e-9);
  // 70/30 voice change moves the wall the same way the slider does.
  const q2 = crewQuarters([
    { name: "Nova", percent: 70 },
    { name: "Orbit", percent: 30 },
  ]);
  assert.ok(Math.abs(q2[0].widthFraction - 0.7) < 1e-9);
  assert.deepEqual(crewQuarters([]), []);
});

test("launch: package launches, all-done is ready, otherwise idle", () => {
  const all = CHECKLIST_PACK.facts.map((f) => f.factId);
  assert.equal(launchState(checklist(), ""), "idle");
  assert.equal(launchState(checklist(["build-landing-pad"]), ""), "idle");
  assert.equal(launchState(checklist(all), ""), "ready");
  assert.equal(launchState(checklist(), "package text"), "launched");
  assert.equal(launchState(checklist(all), "package text"), "launched");
  // Whitespace-only package is no package.
  assert.equal(launchState(checklist(), "   "), "idle");
});

test("planet skin follows the selected world; launch frame rises and fades", () => {
  assert.equal(colonyPalette("Mars").ground, 0xd1603d);
  assert.equal(colonyPalette("Europa").ground, 0x9fd8e8);
  assert.equal(colonyPalette("Andromeda Galaxy").ground, 0x8f7fe8);
  assert.equal(colonyPalette(null).ground, 0x44507a);
  assert.equal(colonyPalette("Pluto").ground, 0x44507a);
  const f0 = launchFrame(0);
  const fMid = launchFrame(1500);
  assert.equal(f0.lift, 0);
  assert.ok(fMid.lift > f0.lift && fMid.alpha <= 1 && fMid.phase > 0);
  assert.ok(launchFrame(2900).alpha < launchFrame(1500).alpha);
});

test("colony component is a read-only Pixi island wired in Canvas", () => {
  const src = readFileSync(new URL("../components/ColonyView.tsx", import.meta.url), "utf8");
  assert.match(src, /from "pixi\.js"|import\("pixi\.js"\)/);
  assert.match(src, /prefers-reduced-motion/);
  assert.match(src, /detectWebGL/);
  assert.match(src, /aria-label/);
  // Read-only board: no shared-state writes, no agent actions.
  assert.doesNotMatch(src, /setState|useCopilotAction|appendMessage/);
  const canvasSrc = readFileSync(new URL("../components/Canvas.tsx", import.meta.url), "utf8");
  const viewportSrc = readFileSync(new URL("../components/ShipViewport.tsx", import.meta.url), "utf8");
  const objectiveSrc = readFileSync(new URL("../components/MissionObjective.tsx", import.meta.url), "utf8");
  assert.match(viewportSrc, /dynamic\(.*ColonyView.*ssr: false/s);
  // The example commands live with the CONTROLS pop-out.
  const popoutSrc = readFileSync(new URL("../components/ControlsPopout.tsx", import.meta.url), "utf8");
  assert.match(popoutSrc, /EXAMPLE_COMMANDS/);
  for (const label of ["Pick Mars", "Make Orbit 70%", "Prepare lawyer summary"]) {
    assert.match(popoutSrc, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(popoutSrc, /onChipCommand\(chip\.command\)/);
  // Chips go through the agent path, not a state shortcut.
  assert.match(objectiveSrc, /onChipCommand\(chip\.command\)/);
  assert.match(canvasSrc, /onChipCommand=\{\(command\) => void sendToAgent\(command\)\}/);
});

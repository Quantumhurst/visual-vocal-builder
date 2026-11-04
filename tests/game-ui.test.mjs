// Game shell tests — lib/game-ui.ts. The HUD, flight plan, and mission
// clock must agree with the same beatProgress() the host questions use,
// and the build queue must not look finished while structures remain.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MODULES,
  flightPlan,
  flightStatusLabel,
  formatClock,
  moduleFor,
  moduleIndex,
  shipLabel,
} from "../lib/game-ui.ts";
import {
  applyChecklistItem,
  applyCompanyName,
  applyEquity,
  applyFilingSteps,
  applyJurisdiction,
  applyLawyerSummary,
  applyRolloverFact,
  withDefaults,
} from "../lib/state-updates.ts";
import { CHECKLIST_PACK, FILING_STEPS_PACK, S85_PACK } from "../lib/knowledge.ts";

const base = () => withDefaults(null);
const allChecklist = () => CHECKLIST_PACK.facts.map((fact) => fact.factId);
const tick = (state, ids) =>
  ids.reduce((next, id) => applyChecklistItem(next, id, true), state);

test("seven modules, one per beat, in walk order, with fees optional", () => {
  assert.deepEqual(
    MODULES.map((module) => module.id),
    ["jurisdiction", "equity", "checklist", "name", "rollover", "filingsteps", "summary"],
  );
  assert.deepEqual(
    MODULES.map((module) => module.code),
    ["01", "02", "03", "04", "05", "06", "07"],
  );
  assert.equal(new Set(MODULES.map((module) => module.short)).size, 7);
  assert.equal(moduleFor("summary").short, "LAUNCH");
  assert.equal(moduleIndex("equity"), 1);
  assert.equal(moduleIndex("summary"), 6);
  assert.equal(MODULES.filter((module) => module.optional).map((module) => module.id).join(","), "filingsteps");
});

test("mission clock pads minutes and rolls over to hours", () => {
  assert.equal(formatClock(0), "00:00");
  assert.equal(formatClock(9), "00:09");
  assert.equal(formatClock(65), "01:05");
  assert.equal(formatClock(600), "10:00");
  assert.equal(formatClock(3661), "1:01:01");
  assert.equal(formatClock(-5), "00:00");
  assert.equal(formatClock(Number.NaN), "00:00");
});

test("initial flight plan is one active step, optional archive, and pending", () => {
  const steps = flightPlan(base(), "jurisdiction");
  assert.equal(steps.length, 7);
  assert.deepEqual(
    steps.map((step) => step.status),
    ["active", "pending", "pending", "pending", "pending", "optional", "pending"],
  );
  assert.equal(steps[0].detail, "unclaimed");
  assert.equal(steps[2].detail, "0/5 built");
});

test("flight plan follows the walk: home base and crew done, build active", () => {
  let state = applyJurisdiction(base(), "Mars");
  state = applyEquity(state, 0, 70, "test");
  const steps = flightPlan(state, "checklist");
  assert.equal(steps[0].status, "done");
  assert.equal(steps[0].detail, "Mars");
  assert.equal(steps[1].status, "done");
  assert.equal(steps[1].detail, "70% / 30%");
  assert.equal(steps[2].status, "active");
});

test("a partly built colony reads IN PROGRESS, not done", () => {
  let state = applyJurisdiction(base(), "Mars");
  state = tick(state, allChecklist().slice(0, 2));
  const steps = flightPlan(state, "rollover");
  assert.equal(steps[2].status, "partial");
  assert.equal(steps[2].detail, "2/5 built");
  assert.equal(flightStatusLabel(steps[2].status), "IN PROGRESS");
  // The build mission is still current; the name beat is still pending.
  assert.equal(steps[3].status, "pending");
  assert.equal(steps[4].status, "active");
});

test("all structures built turns the build queue done and opens the name beat", () => {
  const state = tick(base(), allChecklist());
  const steps = flightPlan(state, "name");
  assert.equal(steps[2].status, "done");
  assert.equal(steps[2].detail, "5/5 built");
  assert.equal(steps[3].status, "active");
  assert.equal(steps[3].detail, "not approved");
});

test("grounded cards and the launch package show online when painted", () => {
  let state = applyJurisdiction(base(), "Europa");
  state = applyEquity(state, 1, 50, "test");
  state = tick(state, allChecklist());
  state = applyCompanyName(state);
  state = applyRolloverFact(state, "s85-what-it-is", "what is s.85?");
  state = applyFilingSteps(state, [FILING_STEPS_PACK.facts[0].factId], "steps?");
  state = applyLawyerSummary(state);
  const steps = flightPlan(state, "summary");
  assert.equal(steps[3].status, "done");
  assert.match(steps[3].detail, /Galactic Bagels/);
  assert.equal(steps[4].status, "done");
  assert.equal(steps[4].detail, "fact online");
  assert.equal(steps[5].status, "done");
  assert.equal(steps[5].detail, "1 fact online");
  assert.equal(steps[6].status, "done");
  assert.equal(steps[6].detail, "package ready");
  // Sanity: the fact we asked for really is in the pack.
  assert.equal(S85_PACK.facts[0].factId, "s85-what-it-is");
});

test("every status has a label", () => {
  for (const status of ["done", "active", "partial", "pending"]) {
    assert.ok(flightStatusLabel(status).length > 0);
  }
});

test("ship name stays hidden until the founder approves it", () => {
  const start = withDefaults(null);
  assert.equal(shipLabel(start), "CALLSIGN PENDING");
  const builtOnly = tick(start, allChecklist());
  assert.equal(shipLabel(builtOnly), "CALLSIGN PENDING");
  const approved = applyCompanyName(builtOnly);
  assert.equal(shipLabel(approved), "GALACTIC BAGELS");
});

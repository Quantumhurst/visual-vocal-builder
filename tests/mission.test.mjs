import { test } from "node:test";
import assert from "node:assert/strict";
import { missionFor } from "../lib/mission.ts";
import { spokenHostText } from "../lib/spoken-text.ts";
import { withDefaults, applyJurisdiction, applyEquity } from "../lib/state-updates.ts";

const base = () => withDefaults(null);

test("mission follows the next incomplete beat", () => {
  const m1 = missionFor(base());
  assert.equal(m1.beat, "jurisdiction");
  assert.equal(m1.step, 1);
  assert.ok(m1.chips.some((c) => /Mars/.test(c.command)));
  const s2 = applyEquity(applyJurisdiction(base(), "Mars"), 1, 70, "test");
  const m2 = missionFor(s2);
  assert.equal(m2.beat, "checklist");
  assert.ok(m2.chips.length >= 1);
});

test("every mission has a sayable prompt and at least one chip", () => {
  const m = missionFor(base());
  assert.ok(m.prompt.length > 10);
  assert.ok(m.total, 6);
  for (const chip of m.chips) {
    assert.ok(chip.label && chip.command);
  }
});

test("spoken text is capped to two short sentences", () => {
  const long = "First sentence here. Second one follows! Third should be dropped? Fourth too.";
  assert.equal(spokenHostText(long), "First sentence here. Second one follows!");
  assert.equal(spokenHostText(""), "");
  assert.equal(spokenHostText("One only."), "One only.");
  assert.ok(spokenHostText("x".repeat(400)).length <= 283);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { COMMANDER, isCommanderLine, withCommander } from "../lib/commander.ts";

test("Commander addresses a line exactly once", () => {
  assert.equal(withCommander("Pick your home base."), "Commander — Pick your home base.");
  assert.equal(withCommander("Commander — Already addressed."), "Commander — Already addressed.");
  assert.equal(withCommander("commander, lower case"), "commander, lower case");
  assert.equal(withCommander(""), "");
  assert.equal(withCommander("   "), "");
});

test("Commander line detection is case-insensitive and prefix-only", () => {
  assert.equal(isCommanderLine("Commander — Mars is home."), true);
  assert.equal(isCommanderLine("commander, ready"), true);
  assert.equal(isCommanderLine("Welcome, Commander."), false);
  assert.equal(isCommanderLine(""), false);
  assert.equal(COMMANDER, "Commander");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { AnnouncementBudget, MAX_ANNOUNCEMENTS_PER_TURN } from "../lib/announcements.ts";

test("AnnouncementBudget: two messages per turn, then stop", () => {
  const budget = new AnnouncementBudget();
  assert.equal(budget.allow(1, "Heard: pick Mars"), true);
  assert.equal(budget.allow(1, "Mars locked in. Next: equity"), true);
  assert.equal(budget.allow(1, "a third status"), false);
  assert.equal(budget.remainingFor(1), 0);
});

test("AnnouncementBudget: repeats are suppressed within a turn", () => {
  const budget = new AnnouncementBudget();
  assert.equal(budget.allow(2, "Heard: yes"), true);
  assert.equal(budget.allow(2, "Heard: yes"), false);
  assert.equal(budget.remainingFor(2), MAX_ANNOUNCEMENTS_PER_TURN - 1);
});

test("AnnouncementBudget: a new turn gets a fresh allowance", () => {
  const budget = new AnnouncementBudget();
  budget.allow(3, "Heard: one");
  budget.allow(3, "Done: one");
  assert.equal(budget.allow(3, "extra"), false);
  assert.equal(budget.allow(4, "Heard: two"), true);
  assert.equal(budget.remainingFor(4), MAX_ANNOUNCEMENTS_PER_TURN - 1);
});

test("AnnouncementBudget: blank messages never consume a slot", () => {
  const budget = new AnnouncementBudget();
  assert.equal(budget.allow(5, "   "), false);
  assert.equal(budget.remainingFor(5), MAX_ANNOUNCEMENTS_PER_TURN);
});

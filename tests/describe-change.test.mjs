import { test } from "node:test";
import assert from "node:assert/strict";
import { describeChange } from "../lib/describe-change.ts";
import { withDefaults, applyEquity, applyJurisdiction, applyChecklistItems, applyLawyerSummary } from "../lib/state-updates.ts";

const base = () => withDefaults(null);

test("jurisdiction change", () => {
  assert.match(describeChange(base(), applyJurisdiction(base(), "Mars")), /Home base: none → Mars/);
});

test("equity change shows both founders and total", () => {
  const out = describeChange(base(), applyEquity(base(), 1, 70, "test"));
  assert.match(out, /Equity:/);
  assert.match(out, /total 100%/);
});

test("0 to 2 tick case from the playthrough", () => {
  const b = base();
  const ids = [b.checklist[0].id, b.checklist[1].id];
  const out = describeChange(b, applyChecklistItems(b, ids, true));
  assert.match(out, /Ticked:/);
  assert.match(out, /2 of \d+ done/);
});

test("no-op carries Current state tail", () => {
  const b = applyJurisdiction(base(), "Mars");
  const out = describeChange(b, b);
  assert.match(out, /^Nothing changed:/);
  assert.match(out, /Current state: Mars/);
});

test("lawyer summary prepared (not sent)", () => {
  assert.match(describeChange(base(), applyLawyerSummary(base())), /Lawyer summary prepared \(not sent\)/);
});

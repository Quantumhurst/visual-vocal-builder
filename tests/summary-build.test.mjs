import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SUMMARY_PROGRESS_STEPS,
  SUMMARY_READY_LINE,
  SUMMARY_START_LINE,
  SUMMARY_STEP_MS,
  clampSummaryProgress,
  nextSummaryProgress,
  summaryBuildCaption,
  summaryBuildHint,
} from "../lib/summary-build.ts";

test("summary progress climbs through visible stages and stops at 100", () => {
  assert.deepEqual([...SUMMARY_PROGRESS_STEPS], [25, 50, 75, 100]);
  assert.equal(nextSummaryProgress(0), 25);
  assert.equal(nextSummaryProgress(25), 50);
  assert.equal(nextSummaryProgress(75), 100);
  assert.equal(nextSummaryProgress(100), 100);
  assert.equal(clampSummaryProgress(-5), 0);
  assert.equal(clampSummaryProgress(140), 100);
  assert.equal(clampSummaryProgress(Number.NaN), 0);
  assert.ok(SUMMARY_STEP_MS > 0);
});

test("the building caption and hints are visible at every stage", () => {
  assert.match(summaryBuildCaption(0), /BUILDING YOUR SUMMARY · 0%/);
  assert.match(summaryBuildCaption(75), /75%/);
  for (const pct of [0, 24, 25, 49, 50, 74, 75, 99, 100]) {
    assert.ok(summaryBuildHint(pct).length > 8, String(pct));
  }
  assert.match(summaryBuildHint(100), /speaking when you pause/i);
});

test("start and ready lines are short enough for the spoken cap", () => {
  assert.match(SUMMARY_START_LINE, /^Building your summary/);
  assert.match(SUMMARY_READY_LINE, /^Summary prepared/);
  assert.ok(SUMMARY_START_LINE.length < 80);
  assert.match(SUMMARY_READY_LINE, /nothing was filed/i);
});

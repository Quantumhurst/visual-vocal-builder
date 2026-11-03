import { test } from "node:test";
import assert from "node:assert/strict";
import { lawyerPackageFingerprint, isLawyerPackageStale } from "../lib/lawyer-summary.ts";
import {
  withDefaults,
  applyEquity,
  applyJurisdiction,
  applyChecklistItem,
  applyFocusJurisdiction,
} from "../lib/state-updates.ts";

const base = () => withDefaults(null);

test("lawyer package fingerprint ignores unrelated UI state", () => {
  const state = base();
  const fingerprint = lawyerPackageFingerprint(state);
  assert.equal(isLawyerPackageStale(state, fingerprint), false);
  assert.equal(
    isLawyerPackageStale(
      { ...state, transcript: "a new transcript" },
      fingerprint,
    ),
    false,
  );
  assert.equal(
    isLawyerPackageStale(
      applyFocusJurisdiction(state, "Europa", "comparison"),
      fingerprint,
    ),
    false,
  );
});

test("lawyer package becomes stale when jurisdiction, equity, or checklist changes", () => {
  const state = base();
  const fingerprint = lawyerPackageFingerprint(state);

  assert.equal(isLawyerPackageStale(applyJurisdiction(state, "Mars"), fingerprint), true);
  assert.equal(isLawyerPackageStale(applyEquity(state, 1, 70, "test"), fingerprint), true);

  const firstItem = state.checklist[0];
  assert.equal(
    isLawyerPackageStale(applyChecklistItem(state, firstItem.id, true), fingerprint),
    true,
  );
});

test("no prepared fingerprint is not stale", () => {
  assert.equal(isLawyerPackageStale(base(), null), false);
  assert.equal(isLawyerPackageStale(base(), ""), false);
});

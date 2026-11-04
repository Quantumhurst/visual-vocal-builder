import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SAVE_KEY,
  clearSavedSession,
  isResumable,
  loadSavedSession,
  parseSavedSession,
  progressSummary,
  sanitizeState,
  saveSession,
  serializeSession,
} from "../lib/persistence.ts";
import {
  applyChecklistItem,
  applyCompanyName,
  applyEquity,
  applyJurisdiction,
  applyLawyerSummary,
  withDefaults,
} from "../lib/state-updates.ts";
import { DEFAULT_VOICE_SETTINGS } from "../lib/voice-controls.ts";
import { CHECKLIST_PACK } from "../lib/knowledge.ts";

function memoryStore() {
  const map = new Map();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, value),
    removeItem: (key) => map.delete(key),
    map,
  };
}

function halfRun() {
  let s = applyCompanyName(applyJurisdiction(withDefaults(null), "Mars"));
  s = applyEquity(s, 0, 70, "test");
  s = applyChecklistItem(s, CHECKLIST_PACK.facts[0].factId, true);
  return s;
}

test("a half-run round-trips through one save slot", () => {
  const store = memoryStore();
  const state = halfRun();
  assert.equal(saveSession(state, DEFAULT_VOICE_SETTINGS, [{ role: "you", text: "Pick Mars", at: 1 }], store), true);
  const saved = loadSavedSession(store);
  assert.ok(saved);
  assert.equal(saved.state.selectedJurisdiction, "Mars");
  assert.equal(saved.state.founders[0].percent, 70);
  assert.equal(saved.state.checklist.filter((item) => item.done).length, 1);
  assert.equal(saved.log[0].text, "Pick Mars");
});

test("settings and transcript survive a reload", () => {
  const state = halfRun();
  const raw = serializeSession(state, { ...DEFAULT_VOICE_SETTINGS, rate: 0.85, slowMode: true }, [
    { role: "host", text: "Pick your home base.", at: 2 },
    { role: "you", text: "Mars", at: 3 },
  ]);
  const saved = parseSavedSession(raw);
  assert.ok(saved);
  assert.equal(saved.settings.rate, 0.85);
  assert.equal(saved.settings.slowMode, true);
  assert.equal(saved.log.length, 2);
  assert.equal(saved.log[0].role, "host");
});

test("corrupt, wrong-version, and empty data fail safe", () => {
  assert.equal(parseSavedSession(null), null);
  assert.equal(parseSavedSession("{not json"), null);
  assert.equal(parseSavedSession(JSON.stringify({ version: 99, state: {} })), null);
  const store = memoryStore();
  store.setItem(SAVE_KEY, "{broken");
  assert.equal(loadSavedSession(store), null);
});

test("a fresh state is not offered as a resume, a real run is", () => {
  assert.equal(isResumable(withDefaults(null)), false);
  assert.equal(isResumable(halfRun()), true);
  assert.equal(isResumable(applyCompanyName(withDefaults(null))), true);
});

test("progress summary names the actual next step", () => {
  const start = withDefaults(null);
  assert.match(progressSummary(start), /Step 1 of 5/);
  const half = halfRun();
  assert.match(progressSummary(half), /Step 4 of 5/);
  assert.match(progressSummary(half), /colony build 1\/5/);
  let done = applyCompanyName(applyJurisdiction(withDefaults(null), "Mars"));
  done = applyEquity(done, 0, 70, "test");
  for (const fact of CHECKLIST_PACK.facts) done = applyChecklistItem(done, fact.factId, true);
  done = applyLawyerSummary(done);
  assert.match(progressSummary(done), /Mission complete/);
  assert.match(progressSummary(done), /lawyer summary ready/);
});

test("sanitizeState repairs structural corruption without throwing", () => {
  const repaired = sanitizeState({
    currentBeat: "nope",
    founders: [{ name: "A", percent: 10 }],
    checklist: [],
    selectedJurisdiction: 3,
    companyName: 42,
  });
  assert.equal(repaired.currentBeat, "jurisdiction");
  assert.equal(repaired.founders.length, 2);
  assert.equal(repaired.founders.reduce((sum, f) => sum + f.percent, 0), 100);
  assert.equal(repaired.checklist.length, 5);
  assert.equal(repaired.selectedJurisdiction, null);
  assert.equal(repaired.companyName, "");
});

test("an old legal-checklist save migrates to a clean guided colony build", () => {
  const old = sanitizeState({
    currentBeat: "checklist",
    selectedJurisdiction: "Mars",
    checklist: [
      { id: "check-choose-place", label: "Choose where to incorporate", guidance: "g", done: true },
      { id: "check-name", label: "Pick a company name", guidance: "g", done: true },
    ],
  });
  assert.equal(old.checklist.length, 5);
  assert.equal(old.checklist[0].id, "build-landing-pad");
  assert.equal(old.checklist[0].label, "Landing pad");
  assert.equal(old.checklist.every((item) => item.done === false), true);
});

test("clear removes the run", () => {
  const store = memoryStore();
  saveSession(halfRun(), DEFAULT_VOICE_SETTINGS, [], store);
  assert.ok(store.getItem(SAVE_KEY));
  clearSavedSession(store);
  assert.equal(store.getItem(SAVE_KEY), null);
});

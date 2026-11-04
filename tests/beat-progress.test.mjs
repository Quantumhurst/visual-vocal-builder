import { test } from "node:test";
import assert from "node:assert/strict";
import { beatProgress } from "../lib/beat-progress.ts";
import { withDefaults, applyEquity, applyJurisdiction, applyChecklistItem } from "../lib/state-updates.ts";

const base = () => withDefaults(null);

test("initial state gives nextBeat jurisdiction", () => {
  const p = beatProgress(base());
  assert.equal(p.nextBeat, "jurisdiction");
  assert.equal(p.done.jurisdiction, false);
  assert.equal(p.done.equity, false);
});

test("Mars plus 30/70 gives nextBeat checklist", () => {
  let s = applyJurisdiction(base(), "Mars");
  s = applyEquity(s, 0, 30, "test");
  const p = beatProgress(s);
  assert.equal(p.done.jurisdiction, true);
  assert.equal(p.done.equity, true);
  assert.equal(p.nextBeat, "checklist");
});

test("equity touched means equity is done (equityNote path)", () => {
  const s = { ...base(), equityNote: "set via voice" };
  assert.equal(beatProgress(s).done.equity, true);
});

test("checklist stays open until every item is ticked", () => {
  const b = applyEquity(applyJurisdiction(base(), "Mars"), 0, 70, "test");
  const one = applyChecklistItem(b, b.checklist[0].id, true);
  assert.equal(beatProgress(one).done.checklist, false);
  assert.equal(beatProgress(one).nextBeat, "checklist");
  const all = b.checklist.reduce(
    (state, item) => applyChecklistItem(state, item.id, true),
    b,
  );
  assert.equal(beatProgress(all).done.checklist, true);
  // The name is approved as its own beat after 5/5.
  assert.equal(beatProgress(all).nextBeat, "name");
});

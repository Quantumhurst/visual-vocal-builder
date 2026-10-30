// Day 5 tests — verifier agent + trust strip (lib/verifier.ts,
// components/TrustStrip.tsx). Run with: npm test (Node built-in runner,
// no new dependencies).
//
// The verifier is a separate check against the knowledge packs — never
// against the talking agent's own claims — and it cannot approve its
// own output. Flagged cards are shown flagged, never dropped/rewritten.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CHECKLIST_PACK,
  FILING_STEPS_PACK,
  S85_PACK,
  findFact,
} from "../lib/knowledge.ts";
import { verifyPaintedCards } from "../lib/verifier.ts";

const s85 = findFact(S85_PACK.packId, "s85-what-it-is");
const filingFacts = FILING_STEPS_PACK.facts.slice(0, 2).map((fact) => ({
  factId: fact.factId,
  topic: fact.topic,
  text: fact.text,
}));
const checklistItems = CHECKLIST_PACK.facts.map((fact) => ({
  id: fact.factId,
  label: fact.topic,
  guidance: fact.text,
  done: false,
}));
const jurisdictions = [
  {
    jurisdiction: "Mars",
    filingFee: "DEMO 500 Mars credits",
    timeline: "DEMO 3 sols",
    directorNote: "DEMO note",
    whyChoose: "DEMO why",
  },
];

function basePainted(overrides = {}) {
  return {
    rolloverCard: null,
    filingStepsCard: null,
    checklist: checklistItems,
    jurisdictions,
    ...overrides,
  };
}

function goodRollover() {
  return {
    question: "What is a section 85 rollover?",
    answer: s85.fact.text,
    packId: S85_PACK.packId,
    factId: s85.fact.factId,
    packTitle: S85_PACK.title,
  };
}

test("verbatim rollover fact -> grounded", () => {
  const result = verifyPaintedCards(
    basePainted({ rolloverCard: goodRollover() }),
  );
  const verdict = result.verdicts.find((v) => v.cardKind === "rollover");
  assert.ok(verdict);
  assert.equal(verdict.status, "grounded");
  assert.equal(verdict.reason, null);
  assert.equal(verdict.emitted, true);
  assert.equal(verdict.rendered, true);
});

test("verbatim filing-steps facts -> grounded", () => {
  const result = verifyPaintedCards(
    basePainted({
      filingStepsCard: {
        question: "What are the filing steps and fees?",
        packId: FILING_STEPS_PACK.packId,
        packTitle: FILING_STEPS_PACK.title,
        facts: filingFacts,
      },
    }),
  );
  const verdict = result.verdicts.find((v) => v.cardKind === "filingSteps");
  assert.ok(verdict);
  assert.equal(verdict.status, "grounded");
  assert.equal(verdict.reason, null);
});

test("checklist item matching its pack fact -> grounded", () => {
  const result = verifyPaintedCards(basePainted());
  const verdicts = result.verdicts.filter((v) => v.cardKind === "checklist");
  assert.equal(verdicts.length, CHECKLIST_PACK.facts.length);
  for (const verdict of verdicts) {
    assert.equal(verdict.status, "grounded", verdict.cardId);
    assert.equal(verdict.reason, null);
  }
});

test("altered card text -> flagged with reason 'text differs'", () => {
  const rollover = verifyPaintedCards(
    basePainted({
      rolloverCard: { ...goodRollover(), answer: `${s85.fact.text} Altered.` },
    }),
  );
  const rv = rollover.verdicts.find((v) => v.cardKind === "rollover");
  assert.equal(rv.status, "flagged");
  assert.equal(rv.reason, "text differs");

  const filing = verifyPaintedCards(
    basePainted({
      filingStepsCard: {
        question: "q",
        packId: FILING_STEPS_PACK.packId,
        packTitle: FILING_STEPS_PACK.title,
        facts: [
          { ...filingFacts[0], text: `${filingFacts[0].text} Altered.` },
          filingFacts[1],
        ],
      },
    }),
  );
  const fv = filing.verdicts.find((v) => v.cardKind === "filingSteps");
  assert.equal(fv.status, "flagged");
  assert.equal(fv.reason, "text differs");

  const altered = checklistItems.map((item, i) =>
    i === 0 ? { ...item, guidance: `${item.guidance} Altered.` } : item,
  );
  const check = verifyPaintedCards(basePainted({ checklist: altered }));
  const cv = check.verdicts.find((v) => v.cardId === altered[0].id);
  assert.equal(cv.status, "flagged");
  assert.equal(cv.reason, "text differs");
});

test("unknown packId or factId -> flagged with reason 'pack/fact missing'", () => {
  const badPack = verifyPaintedCards(
    basePainted({
      rolloverCard: { ...goodRollover(), packId: "no-such-pack" },
    }),
  );
  const pv = badPack.verdicts.find((v) => v.cardKind === "rollover");
  assert.equal(pv.status, "flagged");
  assert.equal(pv.reason, "pack missing");

  const badFact = verifyPaintedCards(
    basePainted({
      rolloverCard: { ...goodRollover(), factId: "no-such-fact" },
    }),
  );
  const fv = badFact.verdicts.find((v) => v.cardKind === "rollover");
  assert.equal(fv.status, "flagged");
  assert.equal(fv.reason, "fact missing");

  const badFiling = verifyPaintedCards(
    basePainted({
      filingStepsCard: {
        question: "q",
        packId: FILING_STEPS_PACK.packId,
        packTitle: FILING_STEPS_PACK.title,
        facts: [{ factId: "no-such-fact", topic: "t", text: "x" }],
      },
    }),
  );
  const sv = badFiling.verdicts.find((v) => v.cardKind === "filingSteps");
  assert.equal(sv.status, "flagged");
  assert.equal(sv.reason, "fact missing");

  const badCheck = verifyPaintedCards(
    basePainted({
      checklist: [
        { id: "no-such-item", label: "x", guidance: "y", done: false },
      ],
    }),
  );
  const cv = badCheck.verdicts.find((v) => v.cardKind === "checklist");
  assert.equal(cv.status, "flagged");
  assert.equal(cv.reason, "fact missing");
});

test("DEMO jurisdiction row -> shown as DEMO, not flagged", () => {
  const result = verifyPaintedCards(basePainted({ rolloverCard: goodRollover() }));
  assert.equal(result.demoItems.length, 1);
  assert.equal(result.demoItems[0].jurisdiction, "Mars");
  assert.equal(result.demoItems[0].status, "DEMO");
  assert.equal(result.counts.demo, 1);
  // DEMO rows never enter the grounded/flagged verdicts.
  assert.ok(result.verdicts.every((v) => v.cardId !== "Mars"));
  assert.equal(result.counts.flagged, 0);
});

test("strip counts match the verdicts", () => {
  const result = verifyPaintedCards(
    basePainted({
      rolloverCard: { ...goodRollover(), answer: "altered text" },
      filingStepsCard: {
        question: "q",
        packId: FILING_STEPS_PACK.packId,
        packTitle: FILING_STEPS_PACK.title,
        facts: filingFacts,
      },
    }),
  );
  assert.equal(result.counts.emitted, result.verdicts.length);
  assert.equal(result.counts.rendered, result.verdicts.length);
  assert.equal(
    result.counts.grounded,
    result.verdicts.filter((v) => v.status === "grounded").length,
  );
  assert.equal(
    result.counts.flagged,
    result.verdicts.filter((v) => v.status === "flagged").length,
  );
  assert.equal(
    result.counts.grounded + result.counts.flagged,
    result.counts.emitted,
  );
});

test("no painted cards -> no verdicts, DEMO still DEMO", () => {
  const result = verifyPaintedCards(
    basePainted({ checklist: [], rolloverCard: null, filingStepsCard: null }),
  );
  assert.equal(result.verdicts.length, 0);
  assert.equal(result.counts.emitted, 0);
  assert.equal(result.counts.grounded, 0);
  assert.equal(result.counts.flagged, 0);
  assert.equal(result.counts.demo, 1);
});

test("verifier is pure and fast (adds no conversation latency)", () => {
  const input = basePainted({ rolloverCard: goodRollover() });
  const first = verifyPaintedCards(input);
  const second = verifyPaintedCards(input);
  assert.deepEqual(first, second);
  const iterations = 200;
  const start = performance.now();
  for (let i = 0; i < iterations; i += 1) verifyPaintedCards(input);
  const perCallMs = (performance.now() - start) / iterations;
  // Pure in-memory string compares; must stay far below a voice turn.
  assert.ok(perCallMs < 5, `verifier too slow: ${perCallMs}ms/call`);
});

test("trust strip is wired live into Canvas and flags show on cards", () => {
  const canvas = readFileSync(
    new URL("../components/Canvas.tsx", import.meta.url),
    "utf8",
  );
  assert.match(canvas, /verifyPaintedCards\(view\)/);
  assert.match(canvas, /<TrustStrip result=\{verification\} \/>/);
  assert.match(canvas, /flagReason=/);
  assert.match(canvas, /flags=\{checklistFlags\}/);
  const strip = readFileSync(
    new URL("../components/TrustStrip.tsx", import.meta.url),
    "utf8",
  );
  assert.match(strip, /data-testid="trust-strip"/);
  assert.match(strip, /FLAGGED/);
  assert.match(strip, /DEMO/);
  const rollover = readFileSync(
    new URL("../components/RolloverFactCard.tsx", import.meta.url),
    "utf8",
  );
  assert.match(rollover, /rollover-flag/);
  const steps = readFileSync(
    new URL("../components/FilingSteps.tsx", import.meta.url),
    "utf8",
  );
  assert.match(steps, /filing-steps-flag/);
  const checklist = readFileSync(
    new URL("../components/FilingChecklist.tsx", import.meta.url),
    "utf8",
  );
  assert.match(checklist, /checklist-flag-/);
});

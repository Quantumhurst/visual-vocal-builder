// Day 3 tests — written in-window for the catalog + knowledge extension.
// Run with: npm test (Node built-in runner, no new dependencies).
//
// Covers the two Day 3 components:
//  - FilingSteps (vvb-filing-steps-v1): grounded in the filing-steps/fees
//    pack; unknown fact ids ground nothing (no card downstream).
//  - LawyerSummary package display (vvb-lawyer-summary-v1): the package
//    built from shared state carries jurisdiction, equity, checklist,
//    the disclaimer, and the explicit no-send line.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FILING_STEPS_PACK,
  KNOWLEDGE_PACKS,
  findFact,
} from "../lib/knowledge.ts";
import { buildLawyerSummary } from "../lib/lawyer-summary.ts";
import { CATALOG } from "../lib/catalog.ts";

test("filing-steps pack is registered and every fact is DEMO-labeled", () => {
  assert.ok(
    KNOWLEDGE_PACKS.some((pack) => pack.packId === FILING_STEPS_PACK.packId),
  );
  assert.equal(FILING_STEPS_PACK.packId, "corp-plan-filing-steps-fees-v1");
  assert.ok(FILING_STEPS_PACK.facts.length >= 5);
  for (const fact of FILING_STEPS_PACK.facts) {
    assert.match(fact.text, /DEMO/, fact.factId);
    assert.match(fact.text, /not legal advice/, fact.factId);
  }
});

test("filing-steps facts ground by pack + fact id; unknown ids ground nothing", () => {
  const found = findFact(FILING_STEPS_PACK.packId, "steps-order-overview");
  assert.ok(found);
  assert.equal(found.pack.packId, "corp-plan-filing-steps-fees-v1");
  assert.match(found.fact.text, /choose where to incorporate/);
  assert.equal(findFact(FILING_STEPS_PACK.packId, "no-such-fact"), null);
  assert.equal(findFact("no-such-pack", "steps-order-overview"), null);
});

test("fees facts state the concept and mark demo figures fictional", () => {
  const concept = findFact(FILING_STEPS_PACK.packId, "fees-concept");
  assert.ok(concept);
  assert.match(concept.fact.text, /filing fee/);
  assert.match(concept.fact.text, /no real amount/);
  const figures = findFact(FILING_STEPS_PACK.packId, "fees-demo-figures");
  assert.ok(figures);
  assert.match(figures.fact.text, /DEMO 500 Mars credits/);
  assert.match(figures.fact.text, /fictional/);
});

const demoView = {
  currentBeat: "summary",
  transcript: "",
  jurisdictions: [],
  selectedJurisdiction: "Mars",
  founders: [
    { name: "DEMO Founder Nova (fictional)", percent: 70 },
    { name: "DEMO Founder Orbit (fictional)", percent: 30 },
  ],
  equityNote: "DEMO Founder Nova (fictional) set to 70% (voice)",
  checklist: [
    { id: "check-choose-place", label: "Choose where to incorporate", guidance: "g", done: true },
    { id: "check-name", label: "Pick a company name", guidance: "g", done: false },
  ],
  rolloverCard: null,
  rolloverNote: "",
  filingStepsCard: {
    question: "What are the filing steps and fees?",
    packId: "corp-plan-filing-steps-fees-v1",
    packTitle: "Corp Plan — filing steps and fees (educational pack)",
    facts: [{ factId: "fees-concept", topic: "How filing fees work (concept)", text: "t" }],
  },
  filingStepsNote: "",
  lawyerPackage: "",
  lawyerNote: "",
};

test("lawyer package carries jurisdiction, equity, checklist, disclaimer, no-send", () => {
  const pkg = buildLawyerSummary(demoView, "Galactic Bagels Inc. (fictional)");
  assert.match(pkg, /Galactic Bagels Inc\. \(fictional\)/);
  assert.match(pkg, /Jurisdiction choice: Mars/);
  assert.match(pkg, /DEMO Founder Nova \(fictional\): 70%/);
  assert.match(pkg, /- \[x\] Choose where to incorporate/);
  assert.match(pkg, /- \[ \] Pick a company name/);
  assert.match(pkg, /not legal advice, not a filing/);
  assert.match(pkg, /does not send email/);
  assert.match(pkg, /corp-plan-filing-steps-fees-v1 \/ fees-concept/);
});

test("lawyer package with nothing selected still states the disclaimer", () => {
  const empty = { ...demoView, selectedJurisdiction: null, filingStepsCard: null };
  const pkg = buildLawyerSummary(empty, "Galactic Bagels Inc. (fictional)");
  assert.match(pkg, /Jurisdiction choice: \(none selected yet\)/);
  assert.match(pkg, /Filing steps\/fees reviewed: \(none\)/);
  assert.match(pkg, /not legal advice/);
});

test("catalog registers both Day 3 components with grounding", () => {
  const steps = CATALOG.find((e) => e.catalogId === "vvb-filing-steps-v1");
  assert.ok(steps);
  assert.equal(steps.component, "FilingSteps");
  assert.match(steps.grounding, /corp-plan-filing-steps-fees-v1/);
  const summary = CATALOG.find((e) => e.catalogId === "vvb-lawyer-summary-v1");
  assert.ok(summary);
  assert.equal(summary.component, "LawyerSummary");
  assert.equal(summary.stateSlice, "lawyerPackage");
});

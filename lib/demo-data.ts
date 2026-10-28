// DEMO DATA ONLY — FOR LIABILITY, every row below is a fictional place,
// never a real jurisdiction, and every value is invented. Mars, Europa, and
// the Andromeda Galaxy are used precisely so nobody can mistake these rows
// for real filing facts. No real jurisdiction facts or real filing data appear
// anywhere in this demo. Fictional demo content only.

import type { ChecklistItem, JurisdictionRow } from "./state";
import type { FounderShare } from "./equity";
import { CHECKLIST_PACK } from "./knowledge";

export const DEMO_JURISDICTIONS: JurisdictionRow[] = [
  {
    jurisdiction: "Mars",
    filingFee: "DEMO 500 Mars credits",
    timeline: "DEMO 3 sols",
    directorNote: "DEMO: at least one Earthling director; Olympus Mons registered office",
    whyChoose: "DEMO: low gravity, high ambition, no Earth taxes (fictional)",
  },
  {
    jurisdiction: "Europa",
    filingFee: "DEMO 400 ice credits",
    timeline: "DEMO 5 Europan days",
    directorNote: "DEMO: subsurface-ocean office; directors must tolerate -160 C",
    whyChoose: "DEMO: the only jurisdiction with a liquid-water moat (fictional)",
  },
  {
    jurisdiction: "Andromeda Galaxy",
    filingFee: "DEMO 2.5 million star credits",
    timeline: "DEMO 2.5 million light-years (one way)",
    directorNote: "DEMO: directors must be reachable by ansible; no physical office",
    whyChoose: "DEMO: name protection across one trillion stars (fictional)",
  },
];

// Fictional demo company — not a real company, never a demo subject drawn
// from real life.
export const DEMO_COMPANY_NAME = "Galactic Bagels Inc. (fictional)";

// DEMO founders — fictional people only, DEMO split labeled on the page.
// Percents total 100; lib/equity.ts keeps them at 100 on every update.
export const DEMO_FOUNDERS: FounderShare[] = [
  { name: "DEMO Founder Nova (fictional)", percent: 60 },
  { name: "DEMO Founder Orbit (fictional)", percent: 40 },
];

// DEMO checklist — items and guidance come from the Corp Plan checklist
// knowledge pack (lib/knowledge.ts), never invented in the component.
export const DEMO_CHECKLIST: ChecklistItem[] = CHECKLIST_PACK.facts.map(
  (fact) => ({
    id: fact.factId,
    label: fact.topic,
    guidance: fact.text,
    done: false,
  }),
);

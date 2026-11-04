// Corp Plan knowledge packs — written in-window for Day 2 (Step 1).
//
// Beat content is grounded in these packs, never invented at render
// time. Every fact carries its pack id + fact id, and the fact card
// shows that grounding on the page. Content is general educational
// guidance only: demo data only, not legal advice, not a filing, and
// nothing here is submitted to any registry. Fictional demo company
// and founders only; no real filing is ever prepared from this pack.

export type KnowledgeFact = {
  factId: string;
  topic: string;
  text: string; // grounded wording shown verbatim on the fact card
};

export type KnowledgePack = {
  packId: string;
  title: string;
  jurisdictionNote: string; // DEMO-labeled scope note
  facts: KnowledgeFact[];
};

export const CHECKLIST_PACK: KnowledgePack = {
  packId: "orbital-foundry-colony-build-v1",
  title: "Orbital Foundry — colony build guide (fictional demo pack)",
  jurisdictionNote:
    "Fictional colony construction guidance for the demo only. These are not legal or filing steps.",
  facts: [
    {
      factId: "build-landing-pad",
      topic: "Landing pad",
      text: "DEMO build step: survey the site, pour the pad, and plant the approach beacon so the first lander has a safe mark. (Fictional colony step — not legal advice.)",
    },
    {
      factId: "build-habitat-dome",
      topic: "Habitat dome",
      text: "DEMO build step: seal the habitat dome, pressurize it, and check the airlock before anyone moves in. (Fictional colony step — not legal advice.)",
    },
    {
      factId: "build-solar-array",
      topic: "Solar array",
      text: "DEMO build step: unfold the solar array, align it with the local star, and bring the first power bus online. (Fictional colony step — not legal advice.)",
    },
    {
      factId: "build-crew-quarters",
      topic: "Crew quarters",
      text: "DEMO build step: fit out the crew quarters with bunks, a galley, and a quiet room so the founders can rest between shifts. (Fictional colony step — not legal advice.)",
    },
    {
      factId: "build-bagel-factory",
      topic: "Bagel factory",
      text: "DEMO build step: assemble the bagel factory and run the first batch, because a fictional corporation needs a product and a smell. (Fictional colony step — not legal advice.)",
    },
  ],
};

// Filing steps + fees pack — written in-window for Day 3 (Step 1).
// General public procedure facts only: the ORDER of steps and the
// CONCEPT of a fee, never a real jurisdiction's live fee schedule.
// Every figure reference stays DEMO-labeled and fictional; a real fee
// is always jurisdiction- and date-specific and is never stated here.
export const FILING_STEPS_PACK: KnowledgePack = {
  packId: "corp-plan-filing-steps-fees-v1",
  title: "Corp Plan — filing steps and fees (educational pack)",
  jurisdictionNote:
    "DEMO guidance summary of general incorporation procedure concepts for the fictional demo only — not legal advice, not a filing.",
  facts: [
    {
      factId: "steps-order-overview",
      topic: "The usual order of steps",
      text: "General procedure: (1) choose where to incorporate, (2) pick and check a company name, (3) agree the founders' equity split, (4) prepare articles, (5) file the articles with the registry and pay the filing fee, (6) complete organizational records. This demo walks the same order as guidance only and files nothing. (DEMO — not legal advice.)",
    },
    {
      factId: "steps-name-check",
      topic: "Name check comes before filing",
      text: "General procedure: a name availability check normally happens before articles are prepared, so a clashed name is caught early. This demo approves a fictional name in the checklist and checks nothing. (DEMO — not legal advice.)",
    },
    {
      factId: "steps-articles-content",
      topic: "What articles generally cover",
      text: "General procedure: articles generally set out the company name, registered office, share classes and transfer restrictions, and director rules. This demo shows guidance only and prepares no filing. (DEMO — not legal advice.)",
    },
    {
      factId: "fees-concept",
      topic: "How filing fees work (concept)",
      text: "Fee concept: incorporating generally involves a one-time government filing fee paid when articles are filed, plus possible name-search and ongoing annual maintenance fees. Amounts vary by jurisdiction and change over time, so this demo states no real amount — demo figures are labeled DEMO and fictional. (DEMO — not legal advice.)",
    },
    {
      factId: "fees-demo-figures",
      topic: "Demo fee figures are fictional",
      text: "Every fee figure in this demo (e.g. DEMO 500 Mars credits) is invented for a fictional place and labeled DEMO in the data file and on the page. No figure here is a real filing fee. (DEMO — not legal advice.)",
    },
    {
      factId: "steps-after-filing",
      topic: "After filing (guidance only)",
      text: "General procedure: after filing, founders typically hold organizational meetings, issue shares per the agreed split, and keep corporate records. This demo stops at guidance and submits nothing to any registry. (DEMO — not legal advice.)",
    },
  ],
};

export const KNOWLEDGE_PACKS: KnowledgePack[] = [
  CHECKLIST_PACK,
  FILING_STEPS_PACK,
];

export function findFact(
  packId: string,
  factId: string,
): { pack: KnowledgePack; fact: KnowledgeFact } | null {
  const pack = KNOWLEDGE_PACKS.find((entry) => entry.packId === packId);
  if (!pack) return null;
  const fact = pack.facts.find((entry) => entry.factId === factId);
  return fact ? { pack, fact } : null;
}

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

export const S85_PACK: KnowledgePack = {
  packId: "corp-plan-ca-s85-rollover-v1",
  title: "Corp Plan — Canada s.85 rollover (educational pack)",
  jurisdictionNote:
    "DEMO guidance summary of Canada Income Tax Act s.85 concepts for the fictional demo only — not legal advice.",
  facts: [
    {
      factId: "s85-what-it-is",
      topic: "What a s.85 rollover is",
      text: "Under s.85(1) of the Canada Income Tax Act, a taxpayer and a taxable Canadian corporation can jointly elect to transfer eligible property to the corporation on a tax-deferred (rollover) basis, so tax on the accrued gain is deferred rather than triggered on the transfer. (Educational summary only — DEMO, not legal advice.)",
    },
    {
      factId: "s85-eligible-property",
      topic: "Eligible property",
      text: "Eligible property for a s.85 election generally includes capital property and certain other property transferred to the corporation; real property held as inventory is a notable exclusion. Whether a specific asset qualifies depends on its character. (Educational summary only — DEMO, not legal advice.)",
    },
    {
      factId: "s85-elected-amount",
      topic: "The elected amount",
      text: "The parties choose an elected amount within statutory limits: it generally cannot exceed the property's fair market value and cannot be less than the non-share consideration (boot) received. The elected amount becomes the transferor's proceeds and drives the corporation's cost in the property. (Educational summary only — DEMO, not legal advice.)",
    },
    {
      factId: "s85-share-consideration",
      topic: "Share consideration is required",
      text: "The consideration the transferor receives must include share consideration — at least one share of the corporation — for the s.85 rollover to apply; taking only non-share consideration (boot) can limit or defeat the elected amount. (Educational summary only — DEMO, not legal advice.)",
    },
    {
      factId: "s85-filing",
      topic: "How the election is filed",
      text: "The s.85 election is made on prescribed form T2057 (T2058 for a partnership), generally due by the earliest tax-return filing-due date of the parties for the tax year of the transfer; late filing is possible within limits with a penalty. This demo never files anything. (Educational summary only — DEMO, not legal advice.)",
    },
  ],
};

export const CHECKLIST_PACK: KnowledgePack = {
  packId: "corp-plan-incorporation-checklist-v1",
  title: "Corp Plan — incorporation walk-through (educational pack)",
  jurisdictionNote:
    "DEMO guidance for the fictional demo company only — guidance and grounded facts only, never a registry filing.",
  facts: [
    {
      factId: "check-choose-place",
      topic: "Choose where to incorporate",
      text: "Guidance: compare where the fictional company will operate, where its directors are, and ongoing compliance effort before choosing. This demo compares fictional places only. (DEMO — not legal advice.)",
    },
    {
      factId: "check-name",
      topic: "Pick a company name",
      text: "Guidance: choose a distinctive fictional name and check it does not clash with names already in use. This demo uses Galactic Bagels Inc. (fictional). (DEMO — not legal advice.)",
    },
    {
      factId: "check-equity",
      topic: "Agree the equity split",
      text: "Guidance: founders agree who owns what before incorporating; in this demo the split always totals 100% and every figure is labeled DEMO. (DEMO — not legal advice.)",
    },
    {
      factId: "check-articles",
      topic: "Prepare articles guidance",
      text: "Guidance: articles set out share classes and transfer restrictions. This demo shows guidance only and prepares no filing. (DEMO — not legal advice.)",
    },
    {
      factId: "check-rollover-question",
      topic: "Ask a rollover question",
      text: "Guidance: if founders transfer existing property into the company, ask about a s.85 rollover and get a grounded fact card before deciding. (DEMO — not legal advice.)",
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
      text: "General procedure: a name availability check normally happens before articles are prepared, so a clashed name is caught early. This demo uses Galactic Bagels Inc. (fictional) and checks nothing. (DEMO — not legal advice.)",
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
  S85_PACK,
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

export function findFactById(
  factId: string,
): { pack: KnowledgePack; fact: KnowledgeFact } | null {
  for (const pack of KNOWLEDGE_PACKS) {
    const fact = pack.facts.find((entry) => entry.factId === factId);
    if (fact) return { pack, fact };
  }
  return null;
}

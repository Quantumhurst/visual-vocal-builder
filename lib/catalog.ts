// Fresh component catalog — written in-window for Day 2 (Step 1).
// A2UI runs in contained mode: the agent drives these catalog
// components through CopilotKit shared state, nothing is rendered
// from raw agent markup. Nothing here is ported from earlier work.

export type CatalogEntry = {
  catalogId: string;
  component: string;
  beat: "jurisdiction" | "equity" | "checklist" | "rollover";
  stateSlice: string;
  drivenBy: string;
  grounding: string;
  description: string;
};

export const CATALOG: CatalogEntry[] = [
  {
    catalogId: "vvb-jurisdiction-table-v1",
    component: "JurisdictionTable",
    beat: "jurisdiction",
    stateSlice: "jurisdictions + selectedJurisdiction",
    drivenBy: "useCoAgent shared state; agent action showJurisdictionComparison",
    grounding: "lib/demo-data.ts (DEMO fictional places)",
    description:
      "Comparison table of fictional places (Mars, Europa, Andromeda Galaxy). DEMO data on the page and in the data file.",
  },
  {
    catalogId: "vvb-equity-slider-v1",
    component: "EquitySlider",
    beat: "equity",
    stateSlice: "founders + equityNote",
    drivenBy:
      "useCoAgent shared state; slider drags and the agent action setFounderEquity both call setFounderShare() in lib/equity.ts",
    grounding: "lib/demo-data.ts DEMO founders; invariant in lib/equity.ts",
    description:
      "Draggable founder equity sliders. Splits always total 100%, enforced in both directions through the one shared-state update path.",
  },
  {
    catalogId: "vvb-filing-checklist-v1",
    component: "FilingChecklist",
    beat: "checklist",
    stateSlice: "checklist",
    drivenBy:
      "useCoAgent shared state; clicks and the agent actions setChecklistItem / advanceChecklist share one update path",
    grounding: "corp-plan-incorporation-checklist-v1 in lib/knowledge.ts",
    description:
      "Incorporation walk-through checklist. Guidance and grounded facts only — never a registry filing, no submission path.",
  },
  {
    catalogId: "vvb-rollover-fact-card-v1",
    component: "RolloverFactCard",
    beat: "rollover",
    stateSlice: "rolloverCard",
    drivenBy:
      "useCoAgent shared state; agent action showRolloverFact looks the fact up in the knowledge pack — unknown ids show no card",
    grounding: "corp-plan-ca-s85-rollover-v1 in lib/knowledge.ts",
    description:
      "Grounded s.85 rollover fact card. Shows its pack id and fact id on the card; an ungrounded answer is never rendered as a card.",
  },
];

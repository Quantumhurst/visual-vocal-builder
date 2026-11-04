import type { FounderShare } from "./equity";

export type JurisdictionRow = {
  jurisdiction: string; // fictional place only, e.g. "Mars", "Europa", "Andromeda Galaxy"
  filingFee: string; // DEMO placeholder value, labeled in lib/demo-data.ts
  timeline: string; // DEMO placeholder value
  directorNote: string; // DEMO placeholder value
  whyChoose: string; // DEMO placeholder value
};

export type ChecklistItem = {
  id: string; // matches a factId in the checklist knowledge pack
  label: string;
  guidance: string; // grounded guidance from the pack, DEMO-labeled
  done: boolean;
};

export type FilingStepsCard = {
  question: string;
  packId: string; // grounding shown on the card
  packTitle: string;
  facts: { factId: string; topic: string; text: string }[]; // verbatim pack text
} | null;

export type SharedState = {
  currentBeat:
    | "jurisdiction"
    | "equity"
    | "checklist"
    | "name"
    | "filingsteps"
    | "summary";
  transcript: string; // last transcript, shown on canvas
  jurisdictions: JurisdictionRow[];
  selectedJurisdiction: string | null; // set by voice (agent) OR by row click
  // The company name is approved by voice as its own beat, immediately
  // after the home base and before equity. "" until the founder approves
  // the fictional demo name.
  companyName: string;
  founders: FounderShare[]; // DEMO founders; percents always total 100
  equityNote: string; // agent's note about the last equity adjustment
  checklist: ChecklistItem[];
  filingStepsCard: FilingStepsCard;
  filingStepsNote: string; // set when a filing-steps answer has no grounded fact
  lawyerPackage: string; // agent- or button-prepared package; "" when none
  lawyerNote: string;
  focusJurisdiction: string | null; // DEMO highlight for comparison; never the user's pick
  focusReason: string; // short host note for the DEMO highlight
};

export type { FounderShare };

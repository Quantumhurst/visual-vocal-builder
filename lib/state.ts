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

export type RolloverCard = {
  question: string;
  answer: string; // verbatim grounded fact text from the knowledge pack
  packId: string; // grounding shown on the card
  factId: string; // grounding shown on the card
  packTitle: string;
} | null;

export type SharedState = {
  currentBeat: "jurisdiction" | "equity" | "checklist" | "rollover";
  transcript: string; // last transcript, shown on canvas
  jurisdictions: JurisdictionRow[];
  selectedJurisdiction: string | null; // set by voice (agent) OR by row click
  founders: FounderShare[]; // DEMO founders; percents always total 100
  equityNote: string; // agent's note about the last equity adjustment
  checklist: ChecklistItem[];
  rolloverCard: RolloverCard;
  rolloverNote: string; // set when a rollover answer has no grounded fact
};

export type { FounderShare };

export type JurisdictionRow = {
  jurisdiction: string; // fictional place only, e.g. "Mars", "Europa", "Andromeda Galaxy"
  filingFee: string; // DEMO placeholder value, labeled in lib/demo-data.ts
  timeline: string; // DEMO placeholder value
  directorNote: string; // DEMO placeholder value
  whyChoose: string; // DEMO placeholder value
};

export type SharedState = {
  currentBeat: "jurisdiction" | "equity" | "checklist" | "rollover";
  transcript: string; // last transcript, shown on canvas
  jurisdictions: JurisdictionRow[];
  selectedJurisdiction: string | null; // set by voice (agent) OR by row click
};

// Day 8 colony logic — pure mapping from shared state to the colony
// board (components/ColonyView.tsx). No Pixi/DOM imports, so the
// build/quarters/launch contracts are unit-testable in Node.
//
// The colony invents nothing: structures come from the checklist ids
// in lib/knowledge.ts (via lib/demo-data.ts), quarter sizes from the
// founders split in lib/equity.ts, and the launch from the prepared
// lawyer package. It reads shared state only; it writes none.

import type { ChecklistItem } from "./state";
import type { FounderShare } from "./equity";

export type StructureKind =
  | "landingPad"
  | "dome"
  | "crewQuarters"
  | "solarArray"
  | "bagelFactory";

export type ColonyStructure = {
  checklistId: string;
  kind: StructureKind;
  label: string;
  built: boolean;
  x: number; // fraction of board width, 0..1
};

// One structure per checklist item, in checklist order. Unknown ids
// still get a slot (kind cycles) so a new pack item never breaks the
// board — it just builds a generic structure under its own label.
const STRUCTURE_KINDS: { checklistId: string; kind: StructureKind; label: string; x: number }[] = [
  { checklistId: "build-landing-pad", kind: "landingPad", label: "Landing pad", x: 0.1 },
  { checklistId: "build-habitat-dome", kind: "dome", label: "Habitat dome", x: 0.3 },
  { checklistId: "build-solar-array", kind: "solarArray", label: "Solar array", x: 0.54 },
  { checklistId: "build-crew-quarters", kind: "crewQuarters", label: "Crew quarters", x: 0.76 },
  { checklistId: "build-bagel-factory", kind: "bagelFactory", label: "Bagel factory", x: 0.9 },
];

export function colonyStructures(checklist: ChecklistItem[]): ColonyStructure[] {
  return checklist.map((item, i) => {
    const known = STRUCTURE_KINDS.find((s) => s.checklistId === item.id);
    if (known) return { checklistId: item.id, kind: known.kind, label: known.label, built: item.done, x: known.x };
    const kinds: StructureKind[] = ["landingPad", "dome", "crewQuarters", "solarArray", "bagelFactory"];
    return {
      checklistId: item.id,
      kind: kinds[i % kinds.length],
      label: item.label,
      built: item.done,
      x: 0.1 + (i % 5) * 0.2,
    };
  });
}

export function colonyProgress(checklist: ChecklistItem[]): { built: number; total: number; percent: number } {
  const total = checklist.length;
  const built = checklist.filter((item) => item.done).length;
  return { built, total, percent: total === 0 ? 0 : Math.round((built / total) * 100) };
}

// Crew quarters: one segment per founder, width share = equity share.
// The quarters building always spans the same total width; equity
// only moves the wall between founders. Shares total 100 (lib/equity
// invariant), so fractions total 1.
export type QuarterSegment = { name: string; percent: number; widthFraction: number };

export function crewQuarters(founders: FounderShare[]): QuarterSegment[] {
  const total = founders.reduce((sum, f) => sum + Math.max(0, f.percent), 0);
  return founders.map((f) => ({
    name: f.name,
    percent: f.percent,
    widthFraction: total > 0 ? Math.max(0, f.percent) / total : founders.length ? 1 / founders.length : 0,
  }));
}

// Launch: the summary package is the launch trigger. All checklist
// items done = ready on the pad; package prepared = launched.
export type LaunchState = "idle" | "ready" | "launched";

export function launchState(checklist: ChecklistItem[], lawyerPackage: string): LaunchState {
  if (lawyerPackage.trim().length > 0) return "launched";
  if (checklist.length > 0 && checklist.every((item) => item.done)) return "ready";
  return "idle";
}

// Planet skin: the selected world colors the ground. No selection
// keeps the neutral deep-space ground. Names come from shared state
// (DEMO_JURISDICTIONS via Canvas), never hard-coded facts — only
// invented demo art colors live here, keyed by name match.
export type ColonyPalette = { ground: number; accent: number; sky: number };

export function colonyPalette(selected: string | null): ColonyPalette {
  switch ((selected ?? "").toLowerCase()) {
    case "mars":
      return { ground: 0xd1603d, accent: 0xffb08a, sky: 0x1c0f1e };
    case "europa":
      return { ground: 0x9fd8e8, accent: 0xd8f4ff, sky: 0x0b1a2e };
    case "andromeda galaxy":
      return { ground: 0x8f7fe8, accent: 0xc9bcff, sky: 0x150f2e };
    default:
      return { ground: 0x44507a, accent: 0x8fa0e8, sky: 0x0b1026 };
  }
}

// Rocket ascent frame: loops a 3s climb (rise + fade near the top),
// pure so the ticker math is testable. Reduced-motion callers skip
// the ticker entirely and render the static frame (phase 0).
export function launchFrame(elapsedMs: number, periodMs = 3000): { lift: number; alpha: number; phase: number } {
  const phase = (((elapsedMs % periodMs) + periodMs) % periodMs) / periodMs;
  return { lift: phase * 170, alpha: phase < 0.8 ? 1 : 1 - (phase - 0.8) / 0.2, phase };
}

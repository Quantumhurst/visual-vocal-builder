// Sound cues for the space-game layer — pure mapping, unit-testable.
// The browser player (Canvas) synthesises these with Web Audio; there
// are no audio assets. A cue is derived from the real state diff, the
// same before/after pair describeChange reports on, so a sound can
// never celebrate a change that did not happen.

import type { SharedState } from "./state.ts";

export type CueName = "select" | "adjust" | "build" | "launch" | "highlight" | "card" | "error";

export type CueRecipe = { notes: { freq: number; atMs: number; durMs: number }[]; type: OscillatorType };

export const CUES: Record<CueName, CueRecipe> = {
  select: { type: "sine", notes: [{ freq: 660, atMs: 0, durMs: 90 }, { freq: 990, atMs: 80, durMs: 140 }] },
  adjust: { type: "triangle", notes: [{ freq: 520, atMs: 0, durMs: 80 }] },
  build: { type: "sine", notes: [{ freq: 440, atMs: 0, durMs: 70 }, { freq: 660, atMs: 60, durMs: 70 }, { freq: 880, atMs: 120, durMs: 120 }] },
  launch: { type: "sawtooth", notes: [{ freq: 220, atMs: 0, durMs: 120 }, { freq: 440, atMs: 90, durMs: 120 }, { freq: 880, atMs: 180, durMs: 220 }] },
  highlight: { type: "sine", notes: [{ freq: 780, atMs: 0, durMs: 100 }] },
  card: { type: "triangle", notes: [{ freq: 590, atMs: 0, durMs: 80 }, { freq: 740, atMs: 70, durMs: 120 }] },
  error: { type: "square", notes: [{ freq: 180, atMs: 0, durMs: 160 }] },
};

export function cueForChange(before: SharedState, after: SharedState): CueName | null {
  if (!before.lawyerPackage && after.lawyerPackage) return "launch";
  if (before.selectedJurisdiction !== after.selectedJurisdiction && after.selectedJurisdiction) return "select";
  const tickedBefore = before.checklist.filter((i) => i.done).length;
  const tickedAfter = after.checklist.filter((i) => i.done).length;
  if (tickedAfter > tickedBefore) return "build";
  if (JSON.stringify(before.rolloverCard) !== JSON.stringify(after.rolloverCard) && after.rolloverCard) return "card";
  if (JSON.stringify(before.filingStepsCard) !== JSON.stringify(after.filingStepsCard) && after.filingStepsCard) return "card";
  if (before.focusJurisdiction !== after.focusJurisdiction && after.focusJurisdiction) return "highlight";
  const equityChanged = before.founders.some((f, i) => f.percent !== after.founders[i]?.percent);
  if (equityChanged) return "adjust";
  if (tickedAfter !== tickedBefore) return "adjust";
  if (before.selectedJurisdiction !== after.selectedJurisdiction) return "adjust";
  return null;
}

// Sound cues for the space-game layer — pure mapping, unit-testable.
// The browser player (Canvas) synthesises these with Web Audio; there
// are no audio assets. A cue is derived from the real state diff, the
// same before/after pair describeChange reports on, so a sound can
// never celebrate a change that did not happen.
//
// Five distinct channels matter in a voice-first app:
//   listen  — the mic just opened, it is your turn
//   think   — the app heard you and is working
//   confirm — a required step is locked in
//   build   — one colony structure went up
//   launch  — the lawyer package is ready

import type { SharedState } from "./state.ts";
import { beatProgress } from "./beat-progress.ts";

export type CueName =
  | "select"
  | "adjust"
  | "build"
  | "launch"
  | "highlight"
  | "card"
  | "error"
  | "listen"
  | "think"
  | "confirm";

export type CueRecipe = { notes: { freq: number; atMs: number; durMs: number }[]; type: OscillatorType };

export const CUES: Record<CueName, CueRecipe> = {
  select: { type: "sine", notes: [{ freq: 660, atMs: 0, durMs: 90 }, { freq: 990, atMs: 80, durMs: 140 }] },
  adjust: { type: "triangle", notes: [{ freq: 520, atMs: 0, durMs: 80 }] },
  build: { type: "sine", notes: [{ freq: 440, atMs: 0, durMs: 70 }, { freq: 660, atMs: 60, durMs: 70 }, { freq: 880, atMs: 120, durMs: 120 }] },
  launch: { type: "sawtooth", notes: [{ freq: 220, atMs: 0, durMs: 120 }, { freq: 440, atMs: 90, durMs: 120 }, { freq: 880, atMs: 180, durMs: 220 }] },
  highlight: { type: "sine", notes: [{ freq: 780, atMs: 0, durMs: 100 }] },
  card: { type: "triangle", notes: [{ freq: 590, atMs: 0, durMs: 80 }, { freq: 740, atMs: 70, durMs: 120 }] },
  error: { type: "square", notes: [{ freq: 180, atMs: 0, durMs: 160 }] },
  // A soft rising pair: the mic opened, speak now.
  listen: { type: "sine", notes: [{ freq: 523, atMs: 0, durMs: 90 }, { freq: 784, atMs: 90, durMs: 150 }] },
  // A quiet pulse: heard you, working.
  think: { type: "triangle", notes: [{ freq: 392, atMs: 0, durMs: 90 }, { freq: 392, atMs: 150, durMs: 90 }] },
  // A warm resolving third: locked in.
  confirm: { type: "sine", notes: [{ freq: 523, atMs: 0, durMs: 80 }, { freq: 659, atMs: 70, durMs: 80 }, { freq: 784, atMs: 140, durMs: 200 }] },
};

export function cueForChange(before: SharedState, after: SharedState): CueName | null {
  if (!before.lawyerPackage && after.lawyerPackage) return "launch";
  if (!before.companyName && after.companyName) return "confirm";
  if (!before.rolloverCard && after.rolloverCard) return "card";
  if (before.selectedJurisdiction !== after.selectedJurisdiction && after.selectedJurisdiction) return "select";
  const tickedBefore = before.checklist.filter((i) => i.done).length;
  const tickedAfter = after.checklist.filter((i) => i.done).length;
  if (tickedAfter > tickedBefore) {
    const nowComplete = after.checklist.length > 0 && after.checklist.every((i) => i.done);
    const wasComplete = before.checklist.length > 0 && before.checklist.every((i) => i.done);
    if (nowComplete && !wasComplete) return "confirm";
    return "build";
  }
  if (JSON.stringify(before.filingStepsCard) !== JSON.stringify(after.filingStepsCard) && after.filingStepsCard) return "card";
  if (before.focusJurisdiction !== after.focusJurisdiction && after.focusJurisdiction) return "highlight";
  const equityChanged = before.founders.some((f, i) => f.percent !== after.founders[i]?.percent);
  if (equityChanged) return "adjust";
  if (tickedAfter !== tickedBefore) return "adjust";
  if (before.selectedJurisdiction !== after.selectedJurisdiction) return "adjust";
  // A required beat completed by some other path (agent, restore).
  const beforeNext = beatProgress(before).nextBeat;
  const afterNext = beatProgress(after).nextBeat;
  if (beforeNext !== afterNext && beforeNext !== "complete") return "confirm";
  return null;
}

import { DEMO_FOUNDERS } from "./demo-data.ts";
import type { SharedState } from "./state.ts";

export type Beat = SharedState["currentBeat"];

// The four missions that actually form the company. The s.85 rollover
// and filing-steps cards remain available as optional reference systems,
// but they no longer block the launch or get pushed as required beats.
export const REQUIRED_BEATS = ["jurisdiction", "equity", "checklist", "summary"] as const;
export const OPTIONAL_BEATS = ["rollover", "filingsteps"] as const;
export type RequiredBeat = (typeof REQUIRED_BEATS)[number];

export function beatProgress(s: SharedState): {
  done: Record<Beat, boolean>;
  nextBeat: RequiredBeat | "complete";
  requiredDone: number;
  requiredTotal: number;
} {
  const equityTouched =
    s.founders.some((f, i) => f.percent !== DEMO_FOUNDERS[i]?.percent) || s.equityNote !== "";
  const done: Record<Beat, boolean> = {
    jurisdiction: s.selectedJurisdiction !== null,
    equity: equityTouched,
    // The build mission stays open until the whole queue is done. A
    // single tick used to advance the walk while the colony was 1/5.
    checklist: s.checklist.length > 0 && s.checklist.every((i) => i.done),
    rollover: s.rolloverCard !== null,
    filingsteps: s.filingStepsCard !== null,
    summary: s.lawyerPackage !== "",
  };
  const nextBeat = REQUIRED_BEATS.find((b) => !done[b]) ?? "complete";
  const requiredDone = REQUIRED_BEATS.filter((b) => done[b]).length;
  return { done, nextBeat, requiredDone, requiredTotal: REQUIRED_BEATS.length };
}

import { DEMO_FOUNDERS } from "./demo-data.ts";
import type { SharedState } from "./state.ts";

export type Beat = SharedState["currentBeat"];

// The five missions that actually form the company, in the order a
// founder walks them by voice:
//   home base -> name -> equity (confirmed) -> 5/5 colony
//   -> prepare the lawyer summary.
// The company name comes immediately after the home base, before equity
// and the build. The filing-steps/fees card remains an optional reference
// system. The old s.85 rollover lesson is not part of this journey.
export const REQUIRED_BEATS = [
  "jurisdiction",
  "name",
  "equity",
  "checklist",
  "summary",
] as const;
export const OPTIONAL_BEATS = ["filingsteps"] as const;
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
    name: s.companyName.trim() !== "",
    rollover: s.rolloverCard !== null,
    filingsteps: s.filingStepsCard !== null,
    summary: s.lawyerPackage !== "",
  };
  const nextBeat = REQUIRED_BEATS.find((b) => !done[b]) ?? "complete";
  const requiredDone = REQUIRED_BEATS.filter((b) => done[b]).length;
  return { done, nextBeat, requiredDone, requiredTotal: REQUIRED_BEATS.length };
}

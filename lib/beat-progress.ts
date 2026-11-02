import { DEMO_FOUNDERS } from "./demo-data.ts";
import type { SharedState } from "./state.ts";

export type Beat = SharedState["currentBeat"];

const ORDER: Beat[] = ["jurisdiction", "equity", "checklist", "rollover", "filingsteps", "summary"];

export function beatProgress(s: SharedState): {
  done: Record<Beat, boolean>;
  nextBeat: Beat | "complete";
} {
  const equityTouched =
    s.founders.some((f, i) => f.percent !== DEMO_FOUNDERS[i]?.percent) || s.equityNote !== "";
  const done: Record<Beat, boolean> = {
    jurisdiction: s.selectedJurisdiction !== null,
    equity: equityTouched,
    checklist: s.checklist.some((i) => i.done),
    rollover: s.rolloverCard !== null,
    filingsteps: s.filingStepsCard !== null,
    summary: s.lawyerPackage !== "",
  };
  const nextBeat = ORDER.find((b) => !done[b]) ?? "complete";
  return { done, nextBeat };
}

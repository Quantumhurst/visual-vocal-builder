// Host copy for the local (click/slider) path — pure, unit-testable.
//
// Agent turns own the spoken line when they reply. Clicks, sliders and
// the left-rail build queue do not run an agent turn, so they update the
// visible host line from the same shared state instead of leaving the
// previous task's line on screen.

import { beatProgress } from "./beat-progress.ts";
import { getHostQuestion, shortFounderNames } from "./host-questions.ts";
import type { SharedState } from "./state.ts";

// The next required objective, in the same words the fallback host uses.
export function nextObjectiveHostLine(state: SharedState): string {
  const next = beatProgress(state).nextBeat;
  if (next === "complete") return "Mission complete — colony founded.";
  return getHostQuestion(next, shortFounderNames(state.founders), state.selectedJurisdiction);
}

// Checklist clicks need progress, not just the static "pick a step" line:
// "1 of 5 structures online. Next: Pick a company name." At 5/5 the next
// required objective is the lawyer summary, so the host hands off to it.
export function checklistHostLine(state: SharedState): string {
  const total = state.checklist.length;
  const built = state.checklist.filter((item) => item.done).length;
  const next = state.checklist.find((item) => !item.done);
  if (beatProgress(state).nextBeat === "summary") {
    return `All ${total} structures online. ${getHostQuestion(
      "summary",
      shortFounderNames(state.founders),
      state.selectedJurisdiction,
    )}`;
  }
  return next
    ? `${built} of ${total} structures online. Next: ${next.label}.`
    : `All ${total} structures online.`;
}

// Equity/owner changes pause on a confirmation card before the cockpit
// advances to BUILD. The line states the actual normalized split from
// shared state, never a proposed raw split that could total more than 100.
export function equityConfirmationLine(state: SharedState): string {
  const owners = state.founders.length;
  const split = state.founders.map((founder) => `${founder.percent}%`).join(" / ");
  const noun = owners === 1 ? "owner" : "owners";
  return `${owners} ${noun} — ${split}. Confirm this split, or choose another owner count.`;
}

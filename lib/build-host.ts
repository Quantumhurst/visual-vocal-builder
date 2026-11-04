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
  if (next === "checklist") return buildQuestionLine(state);
  return getHostQuestion(next, shortFounderNames(state.founders), state.selectedJurisdiction);
}

// The build is an interview, not a bulk checklist. One structure, one
// explicit yes, one spoken confirmation, then the next question.
export function buildQuestionLine(state: SharedState): string {
  const total = state.checklist.length;
  const built = state.checklist.filter((item) => item.done).length;
  const next = state.checklist.find((item) => !item.done);
  if (!next) {
    return getHostQuestion("summary", shortFounderNames(state.founders), state.selectedJurisdiction);
  }
  return `Structure ${built + 1} of ${total}: ${next.label} — ${built} of ${total} are up. Say “yes” to raise it.`;
}

export function buildRaisedLine(state: SharedState, raisedLabel: string): string {
  const total = state.checklist.length;
  const built = state.checklist.filter((item) => item.done).length;
  const next = state.checklist.find((item) => !item.done);
  if (!next) {
    return getHostQuestion("summary", shortFounderNames(state.founders), state.selectedJurisdiction);
  }
  return `${raisedLabel} raised — ${built} of ${total} structures up. Next: ${next.label}, structure ${built + 1} of ${total} — say “yes”.`;
}

export function buildGuideLine(item: { label: string; guidance: string }): string {
  return `${firstSentence(item.guidance)} Say “yes” when you are ready to raise the ${item.label}.`;
}

// Build clicks use the same guided question as voice. At 5/5 the next
// required objective is the lawyer summary, so the host hands off.
export function checklistHostLine(state: SharedState): string {
  const total = state.checklist.length;
  const nextBeat = beatProgress(state).nextBeat;
  if (nextBeat === "summary") {
    // The question itself carries the next step; repeating a count here
    // would be a third sentence and the spoken-text cap would drop it.
    return getHostQuestion("summary", shortFounderNames(state.founders), state.selectedJurisdiction);
  }
  if (nextBeat === "complete") {
    return `All ${total} structures online. Mission complete.`;
  }
  return buildQuestionLine(state);
}

// The company-name approval line. The name is approved right after the
// home base, before equity and the build.
export function nameApprovalLine(state: SharedState): string {
  // One question, two sentences, so the spoken cap never drops it.
  return getHostQuestion("name", shortFounderNames(state.founders), state.selectedJurisdiction);
}

// The spoken confirmation after the name is approved. Two sentences:
// the approval and the next equity cue. The selected-place prefix is
// omitted so the "Inc." sentence cannot push the cue past the speech cap.
export function nameApprovedLine(state: SharedState): string {
  const equityLine = getHostQuestion("equity", shortFounderNames(state.founders));
  return `Company name approved as ${state.companyName}. ${equityLine}`;
}

// Equity/owner changes pause on a confirmation card before the cockpit
// advances to BUILD. The line states the actual normalized split from
// shared state, never a proposed raw split that could total more than 100.
export function equityConfirmationLine(state: SharedState): string {
  const owners = state.founders.length;
  const split = state.founders.map((founder) => `${founder.percent}%`).join(" / ");
  const noun = owners === 1 ? "owner" : "owners";
  // One question. The card owns the SAY cue ("Confirm") and the secondary
  // KEEP EDITING action, so the spoken line never becomes a menu.
  return `${owners} ${noun} — ${split}. Does this ownership look right?`;
}

// One sentence from a longer grounded text, so a spoken line stays short
// enough for the speech cap without paraphrasing the source.
export function firstSentence(text: string): string {
  const clean = (text ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const match = clean.match(/^.*?[.!?](?:\s|$)/);
  return (match ? match[0] : clean).trim();
}

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
  const nextBeat = beatProgress(state).nextBeat;
  if (nextBeat === "name" || nextBeat === "rollover" || nextBeat === "summary") {
    // The question itself carries the count ("five of five") where it
    // matters; repeating it here would be a third sentence and the
    // spoken-text cap would drop the actual question.
    return getHostQuestion(nextBeat, shortFounderNames(state.founders), state.selectedJurisdiction);
  }
  if (nextBeat === "complete") {
    return `All ${total} structures online. Mission complete.`;
  }
  return next
    ? `${built} of ${total} structures online. Next: ${next.label}. Say “Build the next structure”.`
    : `All ${total} structures online.`;
}

// The company-name approval line. The colony must be complete first, so
// a founder never approves a name before the walk reaches that beat.
export function nameApprovalLine(state: SharedState): string {
  // One question, two sentences, so the spoken cap never drops it.
  return getHostQuestion("name", shortFounderNames(state.founders), state.selectedJurisdiction);
}

// Equity/owner changes pause on a confirmation card before the cockpit
// advances to BUILD. The line states the actual normalized split from
// shared state, never a proposed raw split that could total more than 100.
export function equityConfirmationLine(state: SharedState): string {
  const owners = state.founders.length;
  const split = state.founders.map((founder) => `${founder.percent}%`).join(" / ");
  const noun = owners === 1 ? "owner" : "owners";
  // Keep the spoken line free of the exact confirmation/cancel commands
  // ("confirm", "split", "change"). The echo filter compares the user's
  // transcript to what the host just said; if the host says "confirm this
  // split", a genuine "confirm split" is 2/2 host words and gets tombstoned
  // as speaker bleed. The visible confirmation card still shows the exact
  // "confirm"/"change" words. This keeps the 4972d2b echo guard strict.
  return `${owners} ${noun} — ${split}. Does this ownership look right? Say the percentages you want, pick a different owner count, or drag a slider.`;
}

// The host reads one grounded sentence from the s.85 pack; the card
// carries the full verbatim fact and its pack/fact grounding. This keeps
// the spoken line short enough for the speech cap without paraphrasing a
// legal fact: the sentence is taken verbatim from the pack text.
export function firstSentence(text: string): string {
  const clean = (text ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const match = clean.match(/^.*?[.!?](?:\s|$)/);
  return (match ? match[0] : clean).trim();
}

export function rolloverLearnLine(state: SharedState): string {
  // Speak one grounded sentence verbatim. The card carries the rest and
  // its pack/fact grounding; the mission banner carries the next step.
  return firstSentence(state.rolloverCard?.answer ?? "");
}

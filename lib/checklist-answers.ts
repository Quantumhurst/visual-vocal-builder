// Checklist no-op answers — pure, unit-testable.
//
// "Which checklist steps have you finished so far?" has a valid answer
// of "none" / "zero" / "not yet". That answer changes no state, so the
// agent has nothing to call and the old UI looked dead: no tick, no
// spoken reply, and eventually a red "agent finished without changing
// anything" error. These helpers let the command deck acknowledge the
// answer itself, from the real checklist state, without inventing facts.

import type { SharedState } from "./state.ts";

// Deliberately conservative: bare "no" is not here because "no, tick the
// next one" is a command, not a no-op. Phrases that also contain a command
// fall through to the agent.
const NOTHING_DONE_PATTERNS: RegExp[] = [
  /^\s*(?:zero|0)\s*(?:of\s+them|so\s+far|done|checked|finished)?\s*[.!]*$/i,
  /^\s*(?:none|nothing|nope)\s*(?:of\s+them|so\s+far|done|checked|finished)?\s*[.!]*$/i,
  /^\s*not\s+yet\s*[.!]*$/i,
  /\bnone\s+of\s+them\b/i,
  /\bnothing\s+(?:so\s+far|yet|done|checked|finished)\b/i,
  /\b(?:haven'?t|have not|didn'?t|did not)\s+(?:done|finished|checked|ticked)\s+(?:any|anything|none)\b/i,
  /\b(?:zero|none)\s+(?:so\s+far|done|checked|finished)\b/i,
];

export function isNothingDoneAnswer(text: string): boolean {
  const value = (text ?? "").trim();
  if (!value) return false;
  return NOTHING_DONE_PATTERNS.some((pattern) => pattern.test(value));
}

// The acknowledgement is derived from state, never from the model:
// 0 checked gets an invitation to start; a partly built colony gets the
// actual count so a "none" answer cannot contradict the board.
export function checklistNoopReply(state: SharedState): string {
  const total = state.checklist.length;
  const done = state.checklist.filter((item) => item.done).length;
  if (done === 0) {
    return "Understood — nothing checked yet. Which checklist step do you want to start with?";
  }
  return `I have ${done} of ${total} checked so far. Say “tick the next one” or name the step you want to change.`;
}

const COMPANY_NAME_QUESTION_PATTERNS: RegExp[] = [
  /\b(?:what(?:'s|\s+is|\s+was)?|tell me|repeat|verify|check)\s+(?:the\s+|our\s+|a\s+)?(?:company\s+)?name\b/i,
  /\bwhat\s+name\s+(?:did\s+we\s+pick|is\s+it|was\s+picked|do\s+we\s+have)\b/i,
  /\bdid\s+we\s+pick\s+(?:a\s+|the\s+)?(?:company\s+)?name\b/i,
  /\b(?:what\s+is\s+our\s+name|what's\s+our\s+name)\b/i,
];

export function isCompanyNameQuestion(text: string): boolean {
  const value = (text ?? "").trim();
  if (!value) return false;
  return COMPANY_NAME_QUESTION_PATTERNS.some((pattern) => pattern.test(value));
}

export function companyNameReply(): string {
  return "Our fictional company name is Galactic Bagels Inc. (fictional).";
}

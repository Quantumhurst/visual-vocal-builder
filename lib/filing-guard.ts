// Fixed safety answer — pure, unit-testable.
//
// "Is this actually going to file my company?" has one correct answer:
// no, this is a demo. It needs no model turn and no state change, so the
// local lane answers it immediately and leaves Muse Spark for genuinely
// open questions.

const GUARD_PATTERNS: RegExp[] = [
  /\b(?:will|does|do|is|are|can|could|would)\s+(?:this|that|it)\b[^.?!]{0,60}\b(?:file|filed|filing|submit|submitted|register|registered|email|emailed)\b/i,
  /\b(?:file|submit|register|email)\s+(?:my|the|our)\s+(?:company|incorporation|articles|paperwork|filing)\b/i,
  /\b(?:actually|really)\s+(?:file|submit|register|email)\b/i,
];

export const FILING_GUARD_REPLY =
  "No — this is a demo: nothing is filed, emailed, or submitted to any registry. Want to keep building the colony?";

export function isFilingGuardQuestion(text: string): boolean {
  const value = (text ?? "").trim();
  if (!value) return false;
  return GUARD_PATTERNS.some((pattern) => pattern.test(value));
}

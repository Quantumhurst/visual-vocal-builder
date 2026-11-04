// Commander address — pure, unit-testable.
//
// The glasses-style host addresses the founder as Commander at the start
// of the journey and at milestones only. It is a deliberate marker, not a
// verbal tic on every line. The lawyer-summary package itself never uses it.

export const COMMANDER = "Commander";

export function withCommander(line: string): string {
  const clean = (line ?? "").trim();
  if (!clean) return clean;
  if (/^commander\b/i.test(clean)) return clean;
  return `${COMMANDER} — ${clean}`;
}

export function isCommanderLine(line: string): boolean {
  return /^commander\b/i.test((line ?? "").trim());
}

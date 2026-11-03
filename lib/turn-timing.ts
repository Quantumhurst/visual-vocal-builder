// Turn timing — pure collection/summary helpers, unit-testable.
// The canvas stamps these as a voice turn flows (mic → partial →
// final → tool → paint → done) and prints one summary line per turn,
// so "slow" becomes a measured stage instead of a feeling.

export type TurnTimings = {
  micStart?: number;
  firstPartial?: number;
  finalTranscript?: number;
  firstToolCall?: number;
  firstPaint?: number;
  done?: number;
  speechEnd?: number;
  rearm?: number;
  hostChars?: number;
};

function lag(from: number | undefined, to: number | undefined): string {
  if (from === undefined || to === undefined) return "—";
  const ms = Math.max(0, Math.round(to - from));
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

export function summarizeTimings(t: TurnTimings): string {
  const parts = [
    `partial ${lag(t.micStart, t.firstPartial)}`,
    `final ${lag(t.micStart, t.finalTranscript)}`,
    `tool ${lag(t.micStart, t.firstToolCall)}`,
    `paint ${lag(t.micStart, t.firstPaint)}`,
    `done ${lag(t.micStart, t.done)}`,
    `speechEnd ${lag(t.micStart, t.speechEnd)}`,
    `rearm ${lag(t.micStart, t.rearm)}`,
  ];
  if (t.hostChars !== undefined) parts.push(`host ${t.hostChars}ch`);
  return parts.join(", ");
}

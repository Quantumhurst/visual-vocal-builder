// Async lawyer-summary build — pure, unit-testable.
//
// The package itself is a pure function, but the voice loop must not sit
// in a silent wait while the screen fills. These constants drive a short,
// visible build: a spoken start line, a progress caption, and a spoken
// completion when the package lands.

export const SUMMARY_PROGRESS_STEPS = [25, 50, 75, 100] as const;
export const SUMMARY_STEP_MS = 300;

export const SUMMARY_START_LINE = "Building your summary.";
export const SUMMARY_READY_LINE =
  "Summary prepared. Would you like the demo package — nothing was filed or sent?";

export function clampSummaryProgress(pct: number): number {
  if (!Number.isFinite(pct)) return 0;
  return Math.min(100, Math.max(0, Math.round(pct)));
}

export function summaryBuildCaption(pct: number): string {
  return `BUILDING YOUR SUMMARY · ${clampSummaryProgress(pct)}%`;
}

export function summaryBuildHint(pct: number): string {
  const value = clampSummaryProgress(pct);
  if (value < 25) return "Gathering the home base and company name.";
  if (value < 50) return "Adding the equity split.";
  if (value < 75) return "Checking the 5/5 build queue.";
  if (value < 100) return "Preparing the handoff package.";
  return "Ready — speaking when you pause.";
}

export function nextSummaryProgress(current: number): number {
  const value = clampSummaryProgress(current);
  return SUMMARY_PROGRESS_STEPS.find((step) => step > value) ?? 100;
}

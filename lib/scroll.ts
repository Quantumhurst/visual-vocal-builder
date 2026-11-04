// Pure auto-scroll helpers for the latest-turn behaviour (no DOM, unit-testable).
import type { SharedState } from "./state.ts";

// Identifies the *result* of a turn: the beat in view, the section content
// that turn changed, and the host reply text. The transcript is deliberately
// excluded — it is set when a command is sent, before any result exists, so
// a transcript-only change must not trigger a scroll.
export function turnResultSignature(state: SharedState, hostText: string): string {
  return JSON.stringify({
    beat: state.currentBeat,
    host: hostText,
    selected: state.selectedJurisdiction,
    founders: state.founders.map((f) => `${f.name}:${f.percent}`),
    checklistDone: state.checklist.map((i) => (i.done ? "1" : "0")).join(""),
    companyName: state.companyName,
    filing: state.filingStepsCard
      ? state.filingStepsCard.facts.map((f) => f.factId).join(",")
      : state.filingStepsNote,
    lawyer: state.lawyerPackage,
  });
}

// Scroll once per new result, and only once the turn has completed
// (not while loading / streaming, not on every render).
export function shouldAutoScroll(
  isLoading: boolean,
  scrolledSignature: string | null,
  currentSignature: string,
): boolean {
  return !isLoading && scrolledSignature !== null && scrolledSignature !== currentSignature;
}

// Document Y to scroll to so the target sits just below the sticky
// latest-turn header instead of underneath it.
export function computeScrollTop(targetDocumentTop: number, stickyHeight: number, gap = 12): number {
  return Math.max(0, targetDocumentTop - stickyHeight - gap);
}

// Signature-field -> beat section, in page order. A turn can change more
// than one section (e.g. pick a jurisdiction and advance the checklist);
// the earliest changed section on the page is the turn's headline result.
const FIELD_BEATS: [string, string][] = [
  ["selected", "jurisdiction"],
  ["founders", "equity"],
  ["checklistDone", "checklist"],
  ["companyName", "name"],
  ["filing", "filingsteps"],
  ["lawyer", "summary"],
];

// True when a beat-owned field changed (not just host text). Live
// previews use this to start the camera glide while a turn is still
// running; host-only streaming updates never move the viewport.
export function beatFieldChanged(
  previousSignature: string | null,
  currentSignature: string,
): boolean {
  if (!previousSignature) return false;
  try {
    const prev = JSON.parse(previousSignature) as Record<string, unknown>;
    const curr = JSON.parse(currentSignature) as Record<string, unknown>;
    return FIELD_BEATS.some(([field]) => JSON.stringify(prev[field]) !== JSON.stringify(curr[field]));
  } catch {
    return false;
  }
}

export function firstChangedBeat(
  previousSignature: string | null,
  currentSignature: string,
  fallbackBeat: string,
): string {
  if (!previousSignature) return fallbackBeat;
  try {
    const prev = JSON.parse(previousSignature) as Record<string, unknown>;
    const curr = JSON.parse(currentSignature) as Record<string, unknown>;
    for (const [field, beat] of FIELD_BEATS) {
      if (JSON.stringify(prev[field]) !== JSON.stringify(curr[field])) return beat;
    }
  } catch {
    return fallbackBeat;
  }
  return fallbackBeat;
}

// Document Y so a section's end (where its result text/card sits) is at
// the bottom of the viewport, below the sticky latest-turn header.
export function computeSectionScrollTop(
  targetDocumentTop: number,
  targetHeight: number,
  viewportHeight: number,
): number {
  return Math.max(0, targetDocumentTop + targetHeight - viewportHeight);
}

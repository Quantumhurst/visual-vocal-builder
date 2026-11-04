// Game-shell logic for the bridge UI — pure, unit-testable (no DOM, no React).
//
// The shell never invents facts: module names, flight-plan status, and the
// mission clock are all derived from shared state and the same beatProgress()
// the mission banner uses. That keeps the HUD, the flight plan, and the
// agent's next-beat question in agreement.

import { beatProgress, type Beat } from "./beat-progress.ts";
import type { SharedState } from "./state.ts";

export type ModuleMeta = {
  id: Beat;
  code: string;
  label: string; // full system name, shown in the panel header
  short: string; // tab label
  glyph: string; // mono glyph for the tab strip
  blurb: string;
  optional: boolean; // archive system, never required for launch
};

// Display order follows the six-beat walk. The filing card is the only
// optional archive system; every other system is required for launch.
export const MODULES: ModuleMeta[] = [
  { id: "jurisdiction", code: "01", label: "Home base", short: "HOME", glyph: "◎", blurb: "Pick a world", optional: false },
  { id: "equity", code: "02", label: "Crew manifest", short: "CREW", glyph: "◐", blurb: "Split the equity", optional: false },
  { id: "checklist", code: "03", label: "Build queue", short: "BUILD", glyph: "▤", blurb: "Raise five structures", optional: false },
  { id: "name", code: "04", label: "Company name", short: "NAME", glyph: "✦", blurb: "Approve the callsign", optional: false },
  { id: "rollover", code: "05", label: "Rollover lesson", short: "S.85", glyph: "◇", blurb: "Grounded rollover fact", optional: false },
  { id: "filingsteps", code: "06", label: "Filing intel", short: "FEES", glyph: "▥", blurb: "Optional steps & fees", optional: true },
  { id: "summary", code: "07", label: "Launch package", short: "LAUNCH", glyph: "▲", blurb: "Lawyer summary", optional: false },
];

export function moduleFor(id: Beat): ModuleMeta {
  return MODULES.find((module) => module.id === id) ?? MODULES[0];
}

export function moduleIndex(id: Beat): number {
  return Math.max(0, MODULES.findIndex((module) => module.id === id));
}

// Mission clock: M:SS, then H:MM:SS past an hour.
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(totalSeconds) ? totalSeconds : 0));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

export type FlightStatus = "done" | "active" | "partial" | "optional" | "pending";

export type FlightStep = ModuleMeta & {
  index: number;
  status: FlightStatus;
  detail: string;
};

// A step is done when its beat is done. The build queue additionally
// shows partial while structures remain: the mission does not leave the
// checklist beat until 5/5, and the flight plan should say "IN PROGRESS"
// rather than "ACTIVE" once the first structure is up.
export function flightPlan(state: SharedState, active: Beat): FlightStep[] {
  const { done } = beatProgress(state);
  const built = state.checklist.filter((item) => item.done).length;
  const total = state.checklist.length;
  const facts = state.filingStepsCard?.facts.length ?? 0;

  return MODULES.map((module, index) => {
    let status: FlightStatus;
    if (module.id === "checklist" && built > 0 && built < total) {
      status = "partial";
    } else if (done[module.id]) {
      status = "done";
    } else if (module.id === active) {
      status = "active";
    } else if (module.optional) {
      status = "optional";
    } else {
      status = "pending";
    }

    let detail: string;
    switch (module.id) {
      case "jurisdiction":
        detail = state.selectedJurisdiction ?? "unclaimed";
        break;
      case "equity":
        detail = state.founders.map((founder) => `${founder.percent}%`).join(" / ") || "no crew";
        break;
      case "checklist":
        detail = `${built}/${total} built`;
        break;
      case "name":
        detail = state.companyName || "not approved";
        break;
      case "rollover":
        detail = state.rolloverCard ? "fact online" : "lesson pending";
        break;
      case "filingsteps":
        detail = state.filingStepsCard ? `${facts} fact${facts === 1 ? "" : "s"} online` : "no facts yet";
        break;
      case "summary":
        detail = state.lawyerPackage ? "package ready" : "not prepared";
        break;
    }

    return { ...module, index, status, detail };
  });
}

export function flightStatusLabel(status: FlightStatus): string {
  switch (status) {
    case "done":
      return "DONE";
    case "active":
      return "ACTIVE";
    case "partial":
      return "IN PROGRESS";
    case "optional":
      return "OPTIONAL";
    case "pending":
      return "PENDING";
  }
}

// The ship/company name appears only after the founder explicitly
// approves the name beat. Building the "pick a name" structure does not
// name the company; approval does.
export function shipLabel(state: SharedState): string {
  return state.companyName.trim() !== ""
    ? state.companyName
        .replace(/\s*\(fictional\)\s*$/i, "")
        .replace(/\s+Inc\.?.*$/i, "")
        .trim()
        .toUpperCase()
    : "CALLSIGN PENDING";
}

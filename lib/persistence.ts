// Save / resume — pure serialization, unit-testable.
//
// A founder who needs a break must never lose the run. The full shared
// state, voice settings, and transcript are written to localStorage on
// every change (debounced by the caller). Loading is fail-safe: corrupt
// or old data returns null and the app starts fresh instead of throwing.

import { REQUIRED_BEATS, beatProgress } from "./beat-progress.ts";
import { normalizeVoiceSettings, type VoiceSettings } from "./voice-controls.ts";
import { INITIAL_STATE, withDefaults } from "./state-updates.ts";
import type { SharedState } from "./state.ts";

export const SAVE_KEY = "vvb.save.v1";
export const SAVE_VERSION = 1;
export const MAX_LOG_ENTRIES = 240;

export type TranscriptEntry = {
  role: "you" | "host";
  text: string;
  at: number;
};

export type SavedSession = {
  version: 1;
  savedAt: number;
  state: SharedState;
  settings: VoiceSettings;
  log: TranscriptEntry[];
};

const BEATS = new Set<string>(["jurisdiction", "equity", "checklist", "name", "filingsteps", "summary"]);

function cleanEntry(value: unknown): TranscriptEntry | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Record<string, unknown>;
  const role = entry.role === "you" || entry.role === "host" ? entry.role : null;
  const text = typeof entry.text === "string" ? entry.text.trim().slice(0, 2000) : "";
  const at = Number(entry.at);
  if (!role || !text) return null;
  return { role, text, at: Number.isFinite(at) ? at : 0 };
}

export function sanitizeState(raw: unknown): SharedState {
  if (!raw || typeof raw !== "object") return { ...INITIAL_STATE };
  const candidate = raw as Partial<SharedState>;
  const state = withDefaults(candidate);
  // Arrays are the structural spine of the canvas. A corrupt/empty
  // checklist would silently break the 5/5 build, so fall back.
  if (!Array.isArray(state.jurisdictions) || state.jurisdictions.length === 0) {
    state.jurisdictions = INITIAL_STATE.jurisdictions;
  }
  if (!Array.isArray(state.founders) || state.founders.length < 1 || state.founders.length > 5) {
    state.founders = INITIAL_STATE.founders;
  } else {
    state.founders = state.founders
      .map((founder) => ({
        name: String(founder?.name ?? "DEMO Founder (fictional)"),
        percent: Math.min(100, Math.max(0, Math.round(Number(founder?.percent) || 0))),
      }))
      .slice(0, 5);
    const total = state.founders.reduce((sum, f) => sum + f.percent, 0);
    if (total !== 100) state.founders = INITIAL_STATE.founders;
  }
  if (!Array.isArray(state.checklist) || state.checklist.length === 0) {
    state.checklist = INITIAL_STATE.checklist;
  } else {
    state.checklist = state.checklist.map((item) => ({
      id: String(item?.id ?? ""),
      label: String(item?.label ?? ""),
      guidance: String(item?.guidance ?? ""),
      done: item?.done === true,
    }));
  }
  // Older saves used the Corp Plan legal checklist ids ("check-*"). Those
  // are not colony structures and must not be ticked by the guided build.
  // Reset the build to the new five structures, unbuilt, so the interview
  // asks each one instead of inheriting a stale 2/5.
  if (state.checklist.some((item) => item.id.startsWith("check-"))) {
    state.checklist = INITIAL_STATE.checklist.map((item) => ({ ...item, done: false }));
    // A migrated build has to pass through the new interview and its
    // downstream name/summary beats, even if the old run had already
    // marked them. Home base and equity are kept.
    state.currentBeat = "checklist";
    state.companyName = "";
    state.lawyerPackage = "";
    state.lawyerNote = "";
  }
  if (!BEATS.has(String(state.currentBeat))) state.currentBeat = "jurisdiction";
  state.companyName = typeof state.companyName === "string" ? state.companyName.trim() : "";
  state.selectedJurisdiction =
    typeof state.selectedJurisdiction === "string" ? state.selectedJurisdiction : null;
  state.lawyerPackage = typeof state.lawyerPackage === "string" ? state.lawyerPackage : "";
  state.filingStepsCard =
    state.filingStepsCard && typeof state.filingStepsCard === "object" ? state.filingStepsCard : null;
  state.filingStepsNote = typeof state.filingStepsNote === "string" ? state.filingStepsNote : "";
  state.equityNote = typeof state.equityNote === "string" ? state.equityNote : "";
  state.lawyerNote = typeof state.lawyerNote === "string" ? state.lawyerNote : "";
  state.transcript = typeof state.transcript === "string" ? state.transcript : "";
  state.focusJurisdiction =
    typeof state.focusJurisdiction === "string" ? state.focusJurisdiction : null;
  state.focusReason = typeof state.focusReason === "string" ? state.focusReason : "";
  return state;
}

export function serializeSession(
  state: SharedState,
  settings: VoiceSettings,
  log: TranscriptEntry[],
  now = Date.now(),
): string {
  const payload: SavedSession = {
    version: SAVE_VERSION,
    savedAt: now,
    state,
    settings: normalizeVoiceSettings(settings),
    log: log.slice(-MAX_LOG_ENTRIES).map((entry) => ({ ...entry })),
  };
  return JSON.stringify(payload);
}

export function parseSavedSession(raw: string | null | undefined): SavedSession | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || parsed.version !== SAVE_VERSION) return null;
    const savedAt = Number(parsed.savedAt);
    const log = Array.isArray(parsed.log)
      ? parsed.log.map(cleanEntry).filter((entry): entry is TranscriptEntry => entry !== null).slice(-MAX_LOG_ENTRIES)
      : [];
    return {
      version: SAVE_VERSION,
      savedAt: Number.isFinite(savedAt) ? savedAt : 0,
      state: sanitizeState(parsed.state),
      settings: normalizeVoiceSettings(parsed.settings as Partial<VoiceSettings> | undefined),
      log,
    };
  } catch {
    return null;
  }
}

// A saved state is worth offering to resume only once the founder has
// actually moved the walk or opened the summary.
export function isResumable(state: SharedState): boolean {
  return (
    state.selectedJurisdiction !== null ||
    state.companyName.trim() !== "" ||
    state.lawyerPackage !== "" ||
    state.filingStepsCard !== null ||
    state.checklist.some((item) => item.done) ||
    state.founders.some((founder, index) => founder.percent !== INITIAL_STATE.founders[index]?.percent)
  );
}

const LABELS: Record<string, string> = {
  jurisdiction: "home base",
  equity: "crew split",
  checklist: "colony build",
  name: "company name",
  filingsteps: "filing intel",
  summary: "lawyer summary",
};

export function progressSummary(state: SharedState): string {
  if (state.lawyerPackage) return "Mission complete — lawyer summary ready";
  const { nextBeat } = beatProgress(state);
  if (nextBeat === "complete") return "Mission complete";
  const label = LABELS[nextBeat] ?? nextBeat;
  if (nextBeat === "checklist") {
    const built = state.checklist.filter((item) => item.done).length;
    const step = REQUIRED_BEATS.indexOf(nextBeat) + 1;
    return `Step ${step} of ${REQUIRED_BEATS.length} — colony build ${built}/${state.checklist.length}`;
  }
  if (nextBeat === "equity") {
    const split = state.founders.map((founder) => `${founder.percent}%`).join(" / ");
    return `Crew split ${split} — confirm to continue`;
  }
  const step = REQUIRED_BEATS.indexOf(nextBeat) + 1;
  const where = state.selectedJurisdiction ? ` on ${state.selectedJurisdiction}` : "";
  return `Step ${step} of ${REQUIRED_BEATS.length}${where} — next: ${label}`;
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function storage(): StorageLike | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadSavedSession(store: StorageLike | null = storage()): SavedSession | null {
  if (!store) return null;
  try {
    const saved = parseSavedSession(store.getItem(SAVE_KEY));
    if (!saved) return null;
    return isResumable(saved.state) ? saved : null;
  } catch {
    return null;
  }
}

export function saveSession(
  state: SharedState,
  settings: VoiceSettings,
  log: TranscriptEntry[],
  store: StorageLike | null = storage(),
): boolean {
  if (!store) return false;
  try {
    store.setItem(SAVE_KEY, serializeSession(state, settings, log));
    return true;
  } catch {
    return false;
  }
}

export function clearSavedSession(store: StorageLike | null = storage()): void {
  if (!store) return;
  try {
    store.removeItem(SAVE_KEY);
  } catch {
    // Storage is optional; clearing is best-effort.
  }
}

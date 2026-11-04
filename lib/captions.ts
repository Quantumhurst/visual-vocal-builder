// Live captions — pure, unit-testable.
//
// The caption is the primary channel, not a debug log. Two rules are
// enforced here so the screen and the speaker can never disagree:
//
//   1. The host caption is exactly the text the speech engine receives.
//      `spokenHostText` owns the two-sentence/283-character cap, so the
//      caption must run through it too. Showing the uncapped agent reply
//      while speaking a capped version is a lie the viewer cannot see.
//   2. The heard caption is exactly the user's words after ASR metadata
//      is stripped. The label changes LIVE → LAST, never the text.

import { spokenHostText } from "./spoken-text.ts";
import { stripAsrAnnotations } from "./transcript.ts";

export type CaptionRole = "host" | "you";

export type CaptionLine = {
  role: CaptionRole;
  text: string;
  at?: number;
};

/** The host line that is (or will be) spoken. Use this for display. */
export function hostCaption(text: string | null | undefined): string {
  return spokenHostText(stripAsrAnnotations(text ?? ""));
}

/** The user's words with ASR control tokens removed. */
export function heardCaption(text: string | null | undefined): string {
  return stripAsrAnnotations(text ?? "").replace(/\s+/g, " ").trim();
}

/**
 * True when the visible host line is the exact line the host says.
 * Punctuation/whitespace differences are normalised by spokenHostText;
 * a real wording difference is never accepted.
 */
export function captionsAgree(displayed: string | null | undefined, spoken: string | null | undefined): boolean {
  const a = hostCaption(displayed);
  const b = hostCaption(spoken);
  return a === b && a.length > 0;
}

export const CAPTION_HISTORY_LIMIT = 240;

/** Append one line, collapsing an adjacent duplicate and capping history. */
export function appendCaptionLine(
  history: readonly CaptionLine[],
  line: CaptionLine,
  limit = CAPTION_HISTORY_LIMIT,
): CaptionLine[] {
  const text = (line.text ?? "").trim();
  if (!text) return [...history];
  const last = history[history.length - 1];
  if (last && last.role === line.role && last.text.trim() === text) return [...history];
  return [...history, { ...line, text }].slice(-Math.max(1, limit));
}

export type CaptionPhase =
  | "recovering"
  | "host-speaking"
  | "hearing"
  | "listening"
  | "thinking"
  | "re-arming"
  | "paused"
  | "idle";

export type CaptionPhaseInput = {
  convoActive: boolean;
  recording: boolean;
  hasLiveWords: boolean;
  hostSpeaking: boolean;
  busy: boolean;
  recovering: boolean;
  rearming: boolean;
};

/**
 * One status for the whole turn loop. Recovery outranks everything so a
 * dropped turn can never look like a healthy LISTENING state.
 */
export function captionPhase(input: CaptionPhaseInput): CaptionPhase {
  if (input.recovering) return "recovering";
  if (input.hostSpeaking) return "host-speaking";
  if (input.recording) return input.hasLiveWords ? "hearing" : "listening";
  if (input.busy) return "thinking";
  if (input.rearming) return "re-arming";
  if (input.convoActive) return "re-arming";
  return "idle";
}

export type CaptionPhaseLabel = {
  label: string;
  hint: string;
  tone: "live" | "host" | "wait" | "warn" | "idle";
};

export function captionPhaseLabel(phase: CaptionPhase): CaptionPhaseLabel {
  switch (phase) {
    case "recovering":
      return { label: "RECOVERING", hint: "The mic re-arms after this line.", tone: "warn" };
    case "host-speaking":
      return { label: "HOST SPEAKING", hint: "Mic is closed until the line finishes.", tone: "host" };
    case "hearing":
      return { label: "MIC OPEN · HEARING YOU", hint: "The canvas paints as you speak.", tone: "live" };
    case "listening":
      return { label: "MIC OPEN · LISTENING", hint: "Take your time — I will not cut you off.", tone: "live" };
    case "thinking":
      return { label: "THINKING", hint: "Your change is already on screen; the mic re-opens next.", tone: "wait" };
    case "re-arming":
      return { label: "MIC RE-ARMING", hint: "One moment — your turn opens by itself.", tone: "wait" };
    case "paused":
      return { label: "MIC CLOSED", hint: "Say “continue” or press TALK.", tone: "warn" };
    default:
      return { label: "READY", hint: "Say “Enter the bridge” to begin.", tone: "idle" };
  }
}

export type HeardCaptionState = "live" | "last" | "waiting";

export function heardCaptionState(
  live: string | null | undefined,
  last: string | null | undefined,
  recording: boolean,
): HeardCaptionState {
  if (recording && heardCaption(live)) return "live";
  if (heardCaption(last)) return "last";
  return "waiting";
}

export function heardCaptionLabel(state: HeardCaptionState): string {
  switch (state) {
    case "live":
      return "HEARD · LIVE";
    case "last":
      return "HEARD · LAST";
    default:
      return "HEARD";
  }
}

/**
 * Placeholder for the heard line. It must match the actual mic state:
 * never say "the mic is open" while the host is still speaking.
 */
export function heardPlaceholder(phase: CaptionPhase): string {
  switch (phase) {
    case "host-speaking":
      return "Your turn comes next — the mic opens when the host finishes.";
    case "thinking":
      return "Your turn re-arms after the agent answers.";
    case "re-arming":
      return "The mic is reopening — go ahead when it opens.";
    case "recovering":
      return "Recovering — the mic re-arms after this line.";
    case "hearing":
      return "I’m hearing you — keep going.";
    case "listening":
      return "Waiting for your voice — the mic is open.";
    default:
      return "Say “Enter the bridge” to begin.";
  }
}

// The conversation turn as one state machine — pure, unit-testable.
//
// Canvas used to track a turn in a dozen separate flags (recording,
// transcribing, sending, agent running, host speaking, re-arming,
// conversation on, recovery, errors, the held half-sentence, the queued
// turn), and each transition re-checked some of them by hand. This module
// is the single description of that loop:
//
//   mic opens → user speaks → mic closes → transcribe → agent → host
//   speaks → mic re-arms (in conversation) → …
//
// It owns no timers, audio, or network. Hooks dispatch events as those
// happen and act on the decisions the reducer returns:
//
// - `mic` becomes "opening" when the mic should open (the user asked, or
//   an allowed re-arm fired); the caller starts the audio pipeline and
//   dispatches MIC_OPEN when it is live.
// - `outbox` holds a queued turn that is now clear to send; the caller
//   sends it and dispatches SENT.
//
// The rules that used to be repeated (when may the mic re-arm? when does
// a queued turn go?) live here once.

import type { CaptionPhaseInput } from "./captions.ts";
import type { RecoveryKind } from "./recovery.ts";

// "opening": requested, audio pipeline starting. "open": capturing.
export type MicState = "closed" | "opening" | "open";

// What is in flight for the last utterance. These overlap (a send hands
// off to the agent run), so they are independent flags.
export type WorkFlags = { transcribing: boolean; sending: boolean; agent: boolean };
export type WorkKey = keyof WorkFlags;

// Which re-arm timer is running. "pending": the short pause after a host
// line. "recovery": the slower re-arm after a recovery banner or an error.
export type RearmState = "none" | "pending" | "recovery";

export type HeldUtterance = { text: string; at: number };

export type TurnState = {
  // Conversation auto-listen: the mic re-opens by itself after each turn.
  convo: boolean;
  mic: MicState;
  work: WorkFlags;
  hostSpeaking: boolean;
  rearm: RearmState;
  recovery: RecoveryKind | null;
  // A visible turn or transcribe error; the normal re-arm waits it out.
  error: boolean;
  // A slow speaker's unfinished first half, waiting for the rest.
  held: HeldUtterance | null;
  // One turn spoken while the agent was busy. Latest wins.
  queued: { text: string; convoWasActive: boolean } | null;
  // A queued turn that is now clear to send. The caller sends it and
  // dispatches SENT.
  outbox: string | null;
};

export const INITIAL_TURN: TurnState = {
  convo: false,
  mic: "closed",
  work: { transcribing: false, sending: false, agent: false },
  hostSpeaking: false,
  rearm: "none",
  recovery: null,
  error: false,
  held: null,
  queued: null,
  outbox: null,
};

export type TurnEvent =
  // The user starts the conversation (voice entry, TALK, "continue").
  | { type: "CONVO_START" }
  // A manual stop: the loop ends, nothing queued is sent on its behalf.
  | { type: "CONVO_END" }
  // Open the mic now (the user asked, or a greeting ended).
  | { type: "MIC_REQUEST" }
  // The audio pipeline is live.
  | { type: "MIC_OPEN" }
  // Capture could not start: the loop ends, so auto-listen does not retry
  // the same broken audio context forever.
  | { type: "MIC_FAILED" }
  // Capture ended (the utterance is complete, or nothing was said).
  | { type: "MIC_CLOSED" }
  | { type: "WORK"; key: WorkKey; on: boolean }
  | { type: "HOST_START" }
  | { type: "HOST_END" }
  // Barge-in or "stop": the host goes quiet now.
  | { type: "HOST_CANCEL" }
  // Ask for the mic to re-open after the short pause.
  | { type: "REARM_REQUEST" }
  // A re-arm timer fired. Only the timer that is current may act.
  | { type: "REARM_FIRE"; via: "pending" | "recovery" }
  // A re-arm timer was cancelled.
  | { type: "REARM_CANCEL" }
  | { type: "RECOVERY"; kind: RecoveryKind; rearm: boolean }
  | { type: "RECOVERY_CLEAR" }
  | { type: "ERROR"; on: boolean }
  | { type: "HOLD"; text: string; at: number }
  | { type: "HOLD_CLEAR" }
  // A spoken turn arrived while the agent was busy.
  | { type: "QUEUE"; text: string }
  // The caller sent the outbox turn.
  | { type: "SENT" };

export function isBusy(state: TurnState): boolean {
  return state.work.transcribing || state.work.sending || state.work.agent;
}

// The mic is requested or capturing.
export function micHot(state: TurnState): boolean {
  return state.mic !== "closed";
}

// The one rule for re-opening the mic by itself after a host line: only in
// a conversation, only while the mic is closed, nothing is in flight, no
// error is on screen, and the host is not speaking (the mic never hears
// the host).
export function canRearm(state: TurnState): boolean {
  return state.convo && state.mic === "closed" && !isBusy(state) && !state.error && !state.hostSpeaking;
}

// The recovery re-arm does not wait on an error line: the banner is the
// error, and re-arming is its next step.
export function canRecoveryRearm(state: TurnState): boolean {
  return state.convo && state.mic === "closed" && !isBusy(state) && !state.hostSpeaking;
}

// A queued turn goes once the lane is idle, unless the conversation it
// was spoken in has since ended.
function flushQueue(state: TurnState): TurnState {
  if (!state.queued || isBusy(state) || state.outbox !== null) return state;
  if (state.queued.convoWasActive && !state.convo) return { ...state, queued: null };
  return { ...state, outbox: state.queued.text, queued: null };
}

// Opening the mic starts a clean turn and is always barge-in.
function openMic(state: TurnState): TurnState {
  return { ...state, mic: "opening", rearm: "none", hostSpeaking: false, error: false };
}

export function turnReducer(state: TurnState, event: TurnEvent): TurnState {
  switch (event.type) {
    case "CONVO_START":
      return state.convo ? state : { ...state, convo: true };

    case "CONVO_END":
      if (!state.convo && state.rearm === "none" && !state.queued) return state;
      return { ...state, convo: false, rearm: "none", queued: null };

    case "MIC_REQUEST":
      return state.mic === "closed" ? openMic(state) : state;

    case "MIC_OPEN":
      return state.mic === "opening" ? { ...state, mic: "open" } : state;

    case "MIC_FAILED":
      return { ...state, mic: "closed", convo: false, rearm: "none", queued: null };

    case "MIC_CLOSED":
      return state.mic === "closed" ? state : { ...state, mic: "closed" };

    case "WORK": {
      if (state.work[event.key] === event.on) return state;
      const next = { ...state, work: { ...state.work, [event.key]: event.on } };
      return event.on ? next : flushQueue(next);
    }

    case "HOST_START":
      return state.hostSpeaking ? state : { ...state, hostSpeaking: true };

    case "HOST_END":
    case "HOST_CANCEL":
      return state.hostSpeaking ? { ...state, hostSpeaking: false } : state;

    case "REARM_REQUEST":
      return canRearm(state) && state.rearm !== "pending" ? { ...state, rearm: "pending" } : state;

    case "REARM_FIRE": {
      // A stale timer (the other kind, or one already cancelled) does nothing.
      if (state.rearm !== event.via) return state;
      const allowed = event.via === "recovery" ? canRecoveryRearm(state) : canRearm(state);
      return allowed ? openMic(state) : { ...state, rearm: "none" };
    }

    case "REARM_CANCEL":
      return state.rearm === "none" ? state : { ...state, rearm: "none" };

    case "RECOVERY":
      return {
        ...state,
        recovery: event.kind,
        rearm: event.rearm && state.convo ? "recovery" : state.rearm,
      };

    case "RECOVERY_CLEAR":
      if (state.recovery === null && state.rearm !== "recovery") return state;
      return { ...state, recovery: null, rearm: state.rearm === "recovery" ? "none" : state.rearm };

    case "ERROR":
      return state.error === event.on ? state : { ...state, error: event.on };

    case "HOLD":
      return { ...state, held: { text: event.text, at: event.at } };

    case "HOLD_CLEAR":
      return state.held ? { ...state, held: null } : state;

    case "QUEUE":
      // Latest wins; there is never more than one.
      return flushQueue({ ...state, queued: { text: event.text, convoWasActive: state.convo } });

    case "SENT":
      return flushQueue({ ...state, outbox: null });
  }
}

// The deck's turn-phase label, as DeckStatus shows it. "Recording" means
// the mic is actually capturing, not merely requested.
export function turnPhaseOf(state: TurnState): "recording" | "transcribing" | "sending" | "agent-busy" | "idle" {
  if (state.mic === "open") return "recording";
  if (state.work.transcribing) return "transcribing";
  if (state.work.sending) return "sending";
  if (state.work.agent) return "agent-busy";
  return "idle";
}

// The caption console's inputs (lib/captions.ts captionPhase). While the
// mic is actually open the console says LISTENING even during a recovery:
// the screen must match the microphone.
export function captionInputOf(state: TurnState, hasLiveWords: boolean): CaptionPhaseInput {
  const recording = state.mic === "open";
  return {
    convoActive: state.convo,
    recording,
    hasLiveWords,
    hostSpeaking: state.hostSpeaking,
    busy: state.work.sending || state.work.agent,
    recovering: state.recovery !== null && !recording,
    rearming: state.rearm !== "none",
  };
}

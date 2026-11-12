// The conversation turn as one state machine — pure, unit-testable.
//
// Canvas has tracked a turn in a dozen separate flags (recording,
// finishing, transcribing, sending, agent loading, host speaking,
// re-arming, conversation on, recovery, the held half-sentence, the
// queued turn, the error flags), and each transition re-checked some of
// them by hand. This module is the single description of that loop:
//
//   mic opens → user speaks → mic finishes → transcribe → agent → host
//   speaks → mic re-arms (in conversation) → …
//
// It owns no timers, audio, or network. Hooks dispatch events as those
// happen and act on the decisions the reducer returns:
//
// - `micOpening` turns true when the mic should open (a re-arm fired or
//   the user asked); the caller starts the audio pipeline.
// - `outbox` holds a queued turn that is now clear to send; the caller
//   sends it and dispatches SENT.
//
// The rules that used to be repeated (when may the mic re-arm? when does
// a queued turn go?) live here once.

import type { CaptionPhaseInput } from "./captions.ts";
import type { RecoveryKind } from "./recovery.ts";

export type MicState = "closed" | "opening" | "open" | "finishing";
// What the app is doing with the last utterance.
export type WorkState = "idle" | "transcribing" | "sending" | "agent";
// "pending": a re-arm timer is running. "recovery": the recovery banner's
// slower re-arm is running.
export type RearmState = "none" | "pending" | "recovery";

export type HeldUtterance = { text: string; at: number };

export type TurnState = {
  // Conversation auto-listen: the mic re-opens by itself after each turn.
  convo: boolean;
  mic: MicState;
  work: WorkState;
  hostSpeaking: boolean;
  rearm: RearmState;
  recovery: RecoveryKind | null;
  // A visible turn or transcribe error; the mic does not re-arm over it.
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
  work: "idle",
  hostSpeaking: false,
  rearm: "none",
  recovery: null,
  error: false,
  held: null,
  queued: null,
  outbox: null,
};

export type TurnEvent =
  // The user starts the conversation (voice entry, TALK, Space).
  | { type: "CONVO_START" }
  // A manual stop, or a mic failure: the loop ends, nothing is queued.
  | { type: "CONVO_END" }
  // Open the mic now (the user asked, or a first-speak greeting ended).
  | { type: "MIC_REQUEST" }
  | { type: "MIC_OPEN" }
  | { type: "MIC_FAILED" }
  // The utterance is complete; capture is shutting down.
  | { type: "MIC_FINISHING" }
  | { type: "MIC_CLOSED" }
  | { type: "TRANSCRIBE_START" }
  | { type: "TRANSCRIBE_END" }
  // A turn goes to the brain. SEND covers the local hand-off; AGENT the
  // model run. Both end with WORK_DONE.
  | { type: "SEND_START" }
  | { type: "AGENT_START" }
  | { type: "WORK_DONE" }
  | { type: "HOST_START" }
  | { type: "HOST_END" }
  // Barge-in or "stop": the host goes quiet now.
  | { type: "HOST_CANCEL" }
  // Ask for the mic to re-open after the normal short pause.
  | { type: "REARM_REQUEST" }
  // The re-arm (or recovery) timer fired.
  | { type: "REARM_FIRE" }
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
  return state.work !== "idle";
}

// The one rule for re-opening the mic by itself: only in a conversation,
// only while the mic is closed, nothing is in flight, no error is on
// screen, and the host is not speaking (the mic never hears the host).
export function canRearm(state: TurnState): boolean {
  return (
    state.convo &&
    state.mic === "closed" &&
    state.work === "idle" &&
    !state.error &&
    !state.hostSpeaking
  );
}

// The same rule for the recovery banner's re-arm, which does not wait on
// an error line: the banner is the error, and re-arming is its next step.
export function canRecoveryRearm(state: TurnState): boolean {
  return state.convo && state.mic === "closed" && state.work === "idle" && !state.hostSpeaking;
}

// A queued turn goes once the lane is idle, unless the conversation it
// was spoken in has since ended.
function flushQueue(state: TurnState): TurnState {
  if (!state.queued || isBusy(state) || state.outbox !== null) return state;
  if (state.queued.convoWasActive && !state.convo) return { ...state, queued: null };
  return { ...state, outbox: state.queued.text, queued: null };
}

export function turnReducer(state: TurnState, event: TurnEvent): TurnState {
  switch (event.type) {
    case "CONVO_START":
      return { ...state, convo: true };

    case "CONVO_END":
      return { ...state, convo: false, rearm: "none", queued: null };

    case "MIC_REQUEST":
      if (state.mic !== "closed") return state;
      // Barge-in: opening the mic silences the host.
      return { ...state, mic: "opening", rearm: "none", hostSpeaking: false, error: false };

    case "MIC_OPEN":
      return state.mic === "opening" ? { ...state, mic: "open" } : state;

    case "MIC_FAILED":
      // A failed capture ends the loop; otherwise auto-listen would retry
      // the same broken audio context forever.
      return { ...state, mic: "closed", convo: false, rearm: "none", queued: null };

    case "MIC_FINISHING":
      return state.mic === "open" || state.mic === "opening" ? { ...state, mic: "finishing" } : state;

    case "MIC_CLOSED":
      return { ...state, mic: "closed" };

    case "TRANSCRIBE_START":
      return { ...state, work: "transcribing" };

    case "TRANSCRIBE_END":
      return state.work === "transcribing" ? flushQueue({ ...state, work: "idle" }) : state;

    case "SEND_START":
      return { ...state, work: "sending" };

    case "AGENT_START":
      return { ...state, work: "agent" };

    case "WORK_DONE":
      return flushQueue({ ...state, work: "idle" });

    case "HOST_START":
      return { ...state, hostSpeaking: true };

    case "HOST_END":
    case "HOST_CANCEL":
      return { ...state, hostSpeaking: false };

    case "REARM_REQUEST":
      return canRearm(state) ? { ...state, rearm: "pending" } : state;

    case "REARM_FIRE": {
      if (state.rearm === "none") return state;
      const allowed = state.rearm === "recovery" ? canRecoveryRearm(state) : canRearm(state);
      if (!allowed) return { ...state, rearm: "none" };
      return { ...state, rearm: "none", mic: "opening", hostSpeaking: false, error: false };
    }

    case "RECOVERY":
      return {
        ...state,
        recovery: event.kind,
        rearm: event.rearm && state.convo ? "recovery" : state.rearm,
      };

    case "RECOVERY_CLEAR":
      return { ...state, recovery: null, rearm: state.rearm === "recovery" ? "none" : state.rearm };

    case "ERROR":
      return { ...state, error: event.on };

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

// The deck's turn-phase label, as DeckStatus shows it today.
export function turnPhaseOf(state: TurnState): "recording" | "transcribing" | "sending" | "agent-busy" | "idle" {
  if (state.mic === "open" || state.mic === "opening") return "recording";
  if (state.work === "transcribing") return "transcribing";
  if (state.work === "sending") return "sending";
  if (state.work === "agent") return "agent-busy";
  return "idle";
}

// The caption console's inputs (lib/captions.ts captionPhase), from the
// turn state. While the mic is actually open the console says LISTENING
// even during a recovery: the screen must match the microphone.
export function captionInputOf(state: TurnState, hasLiveWords: boolean): CaptionPhaseInput {
  const recording = state.mic === "open" || state.mic === "opening";
  return {
    convoActive: state.convo,
    recording,
    hasLiveWords,
    hostSpeaking: state.hostSpeaking,
    busy: state.work === "sending" || state.work === "agent",
    recovering: state.recovery !== null && !recording,
    rearming: state.rearm !== "none",
  };
}

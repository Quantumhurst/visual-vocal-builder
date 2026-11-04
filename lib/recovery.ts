// Recovery, not stalls — pure, unit-testable.
//
// A glasses-style loop has no visible error modal and no pointer. When a
// turn drops or the host goes silent, the app must say what happened,
// leave the last good line on screen, and re-arm the mic by itself.
// Pausing the conversation is the last resort and is always visible.

export type RecoveryKind =
  | "turn-dropped"
  | "empty-turn"
  | "transcribe-failed"
  | "agent-error"
  | "agent-timeout"
  | "host-silent"
  | "stream-lost"
  | "no-speech"
  | "nothing-changed"
  | "listening-stall";

export type RecoveryNotice = {
  kind: RecoveryKind;
  /** Warn = something failed; info = a recoverable gap was handled. */
  tone: "warn" | "info";
  headline: string;
  detail: string;
  /** The one next thing the user can do. Never a menu. */
  nextStep: string;
};

export const RECOVERY_REARM_MS = 1200;
export const RECOVERY_ESCALATE_AFTER = 3;
export const LISTENING_STALL_MS = 20_000;

const COPY: Record<RecoveryKind, Omit<RecoveryNotice, "kind" | "detail">> = {
  "turn-dropped": {
    tone: "warn",
    headline: "That turn dropped",
    nextStep: "Say it once more — the mic is re-arming.",
  },
  "empty-turn": {
    tone: "warn",
    headline: "I did not catch words that time",
    nextStep: "Say it again — the mic re-arms after this line.",
  },
  "transcribe-failed": {
    tone: "warn",
    headline: "Speech recognition missed that",
    nextStep: "Say it once more — the mic re-arms after this line.",
  },
  "agent-error": {
    tone: "warn",
    headline: "The agent turn failed",
    nextStep: "Nothing was changed. Say the command again — the mic is re-arming.",
  },
  "agent-timeout": {
    tone: "warn",
    headline: "The agent took too long",
    nextStep: "Nothing was changed. Say the command again — the mic is re-arming.",
  },
  "host-silent": {
    tone: "warn",
    headline: "Host audio is silent",
    nextStep: "The line is still on screen. Say “test voice” to retry the host voice.",
  },
  "stream-lost": {
    tone: "info",
    headline: "Live captions disconnected",
    nextStep: "The reliable fallback is carrying the next turn. Keep talking — the mic re-arms.",
  },
  "no-speech": {
    tone: "info",
    headline: "No speech yet",
    nextStep: "The mic is still open. Say a command.",
  },
  "nothing-changed": {
    tone: "warn",
    headline: "That turn changed nothing",
    nextStep: "Say the command again — the mic is re-arming.",
  },
  "listening-stall": {
    tone: "info",
    headline: "I can hear audio but no words have landed",
    nextStep: "Say it once more — the mic is still open.",
  },
};

export function recoveryNotice(kind: RecoveryKind, detail = ""): RecoveryNotice {
  const base = COPY[kind];
  return {
    kind,
    tone: base.tone,
    headline: base.headline,
    detail: detail.trim(),
    nextStep: base.nextStep,
  };
}

export type RecoveryDecision = {
  notice: RecoveryNotice;
  attempts: number;
  rearm: boolean;
  /** Always visible; never a silent pause. */
  escalate: boolean;
};

/**
 * Count consecutive recovery events. We deliberately keep re-arming:
 * a paused mic in a hands-free loop is a stall. After the third event
 * the copy escalates, but the mic still comes back.
 */
export class RecoveryTracker {
  private attempts = 0;

  record(kind: RecoveryKind, detail = ""): RecoveryDecision {
    this.attempts += 1;
    return {
      notice: recoveryNotice(kind, detail),
      attempts: this.attempts,
      rearm: true,
      escalate: this.attempts >= RECOVERY_ESCALATE_AFTER,
    };
  }

  clear(): void {
    this.attempts = 0;
  }

  get count(): number {
    return this.attempts;
  }
}

/**
 * A long, quiet-but-audible turn with no transcript is a stall that the
 * normal no-speech timeout never sees. Surface it without touching the
 * mic: a slow speaker may still be mid-thought.
 */
export function isListeningStall(input: {
  recording: boolean;
  hasTranscript: boolean;
  heardAudio: boolean;
  listenedMs: number;
}): boolean {
  return (
    input.recording &&
    !input.hasTranscript &&
    input.heardAudio &&
    input.listenedMs >= LISTENING_STALL_MS
  );
}

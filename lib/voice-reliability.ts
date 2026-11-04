// Pure voice-reliability helpers (no DOM, unit-testable).

export interface TranscribeFailure {
  plain: string;
  detail: string;
}

export interface VoiceErrorState {
  turnError: string;
  transcribeFailure: TranscribeFailure | null;
  notice: string;
}

export const EMPTY_VOICE_ERRORS: VoiceErrorState = {
  turnError: "",
  transcribeFailure: null,
  notice: "",
};

// A new turn (recording start, typed send, or retry) starts from a clean
// error slate. Transcript and host reply live outside this state, so
// clearing errors never clears them. Returns a fresh object each call.
export function clearedVoiceErrors(): VoiceErrorState {
  return { turnError: "", transcribeFailure: null, notice: "" };
}

// Plain language leads; the exact upstream detail is kept verbatim.
export function makeTranscribeFailure(detail: string): TranscribeFailure {
  const trimmed = detail.trim();
  return {
    plain: "Speech service busy — your command was not heard. Try again in a moment.",
    detail: trimmed ? trimmed : "unknown error",
  };
}

// Retry is only possible when a recorded audio buffer is held in memory.
export function hasRetryAudio(lastAudio: ArrayBuffer | null | undefined): boolean {
  return Boolean(lastAudio) && (lastAudio as ArrayBuffer).byteLength > 0;
}

// Timeouts & Guard Rails (Fixes 1–5):
// Prevent any turn stage from hanging indefinitely, without cutting a
// slow speaker off mid-thought. The utterance cap sits below the 60s
// PCM upload limit; the no-speech window is a patient 12s of complete
// silence before the first word, not a mid-sentence pause.
export const ASR_TIMEOUT_MS = 30_000;
export const AGENT_WATCHDOG_MS = 25_000;
export const NO_SPEECH_TIMEOUT_MS = 12_000;
export const MAX_UTTERANCE_MS = 55_000;
export const SPEECH_POLL_TIMEOUT_MS = 15_000;

export function isEmptyTranscript(transcript: string | null | undefined): boolean {
  return !(transcript ?? "").trim();
}

export function emptyTranscriptReply(): string {
  return "Didn't catch that — say it again.";
}

export function noSpeechReply(): string {
  return "Didn't hear anything — say it again.";
}

export function shouldTriggerNoSpeech(hasSpoken: boolean, listenedMs: number): boolean {
  return !hasSpoken && listenedMs >= NO_SPEECH_TIMEOUT_MS;
}

export function shouldCapUtterance(listenedMs: number): boolean {
  return listenedMs >= MAX_UTTERANCE_MS;
}

export function shouldForceReArm(waitedMs: number): boolean {
  return waitedMs >= SPEECH_POLL_TIMEOUT_MS;
}

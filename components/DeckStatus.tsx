"use client";

// The command deck's status strip and alerts: turn phase, conversation and
// host-audio state, autosave, the single polite live region, the recovery
// banner, and transcribe/turn errors. Presentation only.

import { captionPhaseLabel, type CaptionPhase } from "../lib/captions";
import type { RecoveryNotice } from "../lib/recovery";
import { settingsSummary, type VoiceSettings } from "../lib/voice-controls";
import type { TranscribeFailure } from "../lib/voice-reliability";

type Props = {
  turnPhase: "recording" | "transcribing" | "sending" | "agent-busy" | "idle";
  recovery: RecoveryNotice | null;
  rearming: boolean;
  hostSpeaking: boolean;
  elapsed: number;
  captionState: CaptionPhase;
  flowStatus: string;
  settings: VoiceSettings;
  voiceAudiblyOn: boolean;
  hostSilent: boolean;
  savedNotice: string;
  voiceOn: boolean;
  announcement: { id: number; text: string } | null;
  turnError: string;
  transcribeFailure: TranscribeFailure | null;
  hasLastAudio: boolean;
  retryDisabled: boolean;
  retryTranscribe: () => void;
  notice: string;
};

export default function DeckStatus({
  turnPhase,
  recovery,
  rearming,
  hostSpeaking,
  elapsed,
  captionState,
  flowStatus,
  settings,
  voiceAudiblyOn,
  hostSilent,
  savedNotice,
  voiceOn,
  announcement,
  turnError,
  transcribeFailure,
  hasLastAudio,
  retryDisabled,
  retryTranscribe,
  notice,
}: Props) {
  return (
    <>
      <div className="deck-status">
        <span data-testid="turn-phase" className={`deck-phase phase-${turnPhase}`}>
          {recovery
            ? "Recovering…"
            : rearming
              ? "Re-arming…"
              : hostSpeaking
                ? "Host speaking…"
                : turnPhase === "recording"
                  ? "Recording…"
                  : turnPhase === "transcribing"
                    ? "Transcribing…"
                    : turnPhase === "sending"
                      ? "Sending…"
                      : turnPhase === "agent-busy"
                        ? `Agent working… ${elapsed}s`
                        : "Ready"}
        </span>
        <span data-testid="convo-status" className="deck-convo" data-phase={captionState}>
          {captionPhaseLabel(captionState).label}
        </span>
        <span data-testid="flow-status" className="deck-flow">
          {flowStatus}
        </span>
        <span data-testid="voice-settings" className="deck-settings" aria-label="Voice settings">
          {settingsSummary(settings)}
        </span>
        <span
          data-testid="host-audio"
          className={`deck-host-audio${!voiceAudiblyOn || hostSilent ? " is-silent" : hostSpeaking ? " is-speaking" : ""}`}
        >
          {!voiceAudiblyOn
            ? "HOST AUDIO OFF"
            : hostSilent
              ? "HOST AUDIO SILENT"
              : hostSpeaking
                ? "HOST AUDIO SPEAKING"
                : "HOST AUDIO READY"}
        </span>
        {savedNotice ? (
          <span data-testid="autosave" className="deck-saved">
            {savedNotice}
          </span>
        ) : null}
        {!voiceOn ? (
          <span className="deck-vox-off" data-testid="vox-off">
            VOX OFF
          </span>
        ) : null}
      </div>

      {/* One live region for the turn story. Visual statuses above stay
          visible but are not live; this prevents a polite-region pile-up
          while keeping "heard" + result available to a screen reader. */}
      <p
        className="visually-hidden"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-testid="turn-announcement"
      >
        {announcement?.text ?? ""}
      </p>

      {recovery ? (
        <div
          className="recovery-banner"
          data-testid="recovery-banner"
          data-kind={recovery.kind}
          role="alert"
        >
          <span className="recovery-kicker">RECOVERY</span>
          <div className="recovery-copy">
            <strong>{recovery.headline}</strong>
            {recovery.detail ? <span className="recovery-detail">{recovery.detail}</span> : null}
            <span className="recovery-next">{recovery.nextStep}</span>
          </div>
          {rearming ? <span className="recovery-rearm">MIC RE-ARMING</span> : null}
        </div>
      ) : null}

      {!voiceAudiblyOn ? (
        <p data-testid="host-audio-off" className="alert" role="alert">
          Host voice is off. Say “voice on” or “test voice” — I will turn it back on.
        </p>
      ) : hostSilent && recovery?.kind !== "host-silent" ? (
        <p data-testid="host-audio-error" className="alert" role="alert">
          No host audio started. Check the tab mute and the system output device, then say “test
          voice” — I will retry with the system default voice.
        </p>
      ) : null}
      {turnError && !recovery ? (
        <p data-testid="turn-error" className="alert" role="alert">
          {turnError}
        </p>
      ) : null}
      {transcribeFailure ? (
        <div data-testid="transcribe-failure" className="alert">
          <p role="alert">
            {transcribeFailure.plain}{" "}
            <span data-testid="transcribe-failure-detail">
              Transcribe failed: {transcribeFailure.detail}
            </span>
          </p>
          {hasLastAudio ? (
            <button
              type="button"
              className="btn"
              data-testid="retry-transcribe"
              disabled={retryDisabled}
              onClick={retryTranscribe}
            >
              Retry
            </button>
          ) : (
            <p data-testid="typed-fallback-hint" className="micro">
              Type the command below to send it without voice.
            </p>
          )}
        </div>
      ) : null}
      {notice ? (
        <p className="deck-notice" role="status" aria-live="polite" data-testid="deck-notice">
          {notice}
        </p>
      ) : null}
    </>
  );
}

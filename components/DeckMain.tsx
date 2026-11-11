"use client";

// The command deck's main row: the mic orb, the live HOST/HEARD captions
// and mic meter, the typed-command fallback, and UNDO / TRANSCRIPT /
// CONTROLS. Presentation only; every control calls back into Canvas.

import CaptionConsole from "./CaptionConsole";
import type { CaptionPhase, HeardCaptionState } from "../lib/captions";

type Props = {
  recording: boolean;
  convoActive: boolean;
  micDisabled: boolean;
  micLabel: string;
  busy: boolean;
  onToggleRecording: () => void;
  hostText: string;
  heardText: string;
  heardState: HeardCaptionState;
  captionState: CaptionPhase;
  hostHealth: string;
  ack: string;
  holdText: string | null;
  summaryBuild: { pct: number; ready: boolean } | null;
  recordSeconds: number;
  micLevel: number;
  livePreview: { key: string; label: string; status: "live" | "confirming" | "confirmed" } | null;
  typed: string;
  setTyped: (text: string) => void;
  inputDisabled: boolean;
  canSend: boolean;
  // Sends the typed command and clears the box.
  onSendTyped: () => void;
  historySize: number;
  onUndo: () => void;
  transcriptOpen: boolean;
  onToggleTranscript: () => void;
  dockOpen: boolean;
  toggleControls: () => void;
};

export default function DeckMain({
  recording,
  convoActive,
  micDisabled,
  micLabel,
  busy,
  onToggleRecording,
  hostText,
  heardText,
  heardState,
  captionState,
  hostHealth,
  ack,
  holdText,
  summaryBuild,
  recordSeconds,
  micLevel,
  livePreview,
  typed,
  setTyped,
  inputDisabled,
  canSend,
  onSendTyped,
  historySize,
  onUndo,
  transcriptOpen,
  onToggleTranscript,
  dockOpen,
  toggleControls,
}: Props) {
  return (
    <div className="deck-main">
      <button
        type="button"
        className={`mic-orb${recording ? " is-live" : ""}${convoActive ? " is-convo" : ""}`}
        data-testid="mic-button"
        onClick={onToggleRecording}
        disabled={micDisabled}
        aria-label={micLabel}
        title={micLabel}
      >
        <span className="mic-ring" aria-hidden="true" />
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <path
            d="M12 15a4 4 0 0 0 4-4V6a4 4 0 0 0-8 0v5a4 4 0 0 0 4 4Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
          />
          <path
            d="M5 11a7 7 0 0 0 14 0M12 18v3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
          />
        </svg>
        <span className="mic-caption">
          {recording ? "STOP" : convoActive && busy ? "WAIT" : "TALK"}
        </span>
      </button>

      <div className="deck-readout">
        <CaptionConsole
          hostText={hostText}
          heardText={heardText}
          heardState={heardState}
          phase={captionState}
          hostHealth={hostHealth}
          ack={ack}
          holdText={holdText}
          summaryBuild={summaryBuild}
        />
        <div className="deck-kicker">
          <span className="deck-mode">{convoActive ? "CONVERSATION" : "PUSH TO TALK"}</span>
          <span className="deck-hint">SPACE to talk · 1–6 systems</span>
        </div>

        {recording || livePreview ? (
          <div data-testid="live-voice-panel" className="live-panel">
            {recording ? (
              <div
                data-testid="mic-meter"
                className="meter"
                aria-label={`Microphone level, recording ${recordSeconds} seconds`}
              >
                {[0.15, 0.35, 0.55, 0.75, 0.95].map((bar) => (
                  <span key={bar} className={micLevel >= bar ? "is-on" : ""} />
                ))}
                <span className="meter-time">
                  ● {recordSeconds}s {micLevel > 0.05 ? "— HEARING YOU" : "— LISTENING"}
                </span>
              </div>
            ) : null}
            {livePreview ? (
              <p data-testid="live-preview" className="live-preview">
                {livePreview.status === "confirmed"
                  ? `Confirmed — ${livePreview.label.replace(/…$/, "")}`
                  : `${livePreview.label}${
                      livePreview.status === "confirming" ? " · confirming" : " · provisional"
                    }`}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="deck-input">
        <input
          value={typed}
          disabled={inputDisabled}
          onChange={(event) => setTyped(event.target.value)}
          onKeyDown={(event) => {
              if (event.key === "Enter") onSendTyped();
            }}
          placeholder="Or type a command for the agent"
          aria-label="Type a command for the agent"
        />
        <button
          type="button"
          className="btn btn-primary"
          disabled={!canSend || !typed.trim()}
          onClick={onSendTyped}
        >
          {busy ? "WORKING" : "SEND"}
        </button>
      </div>

      <div className="deck-tools">
        <button
          type="button"
          className="btn"
          data-testid="undo-button"
          disabled={historySize === 0}
          onClick={onUndo}
        >
          UNDO
        </button>
        <button
          type="button"
          className="btn"
          data-testid="transcript-toggle"
          aria-expanded={transcriptOpen}
          onClick={onToggleTranscript}
        >
          {transcriptOpen ? "HIDE TRANSCRIPT" : "TRANSCRIPT"}
        </button>
        <button
          type="button"
          className="btn"
          data-testid="dock-expand"
          aria-expanded={dockOpen}
          aria-label="Controls — host voice, sound, quick commands"
          title="Controls — host voice, sound, quick commands"
          onClick={toggleControls}
        >
          {dockOpen ? "CLOSE" : "CONTROLS"}
        </button>
      </div>
    </div>
  );
}

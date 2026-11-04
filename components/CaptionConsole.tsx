"use client";

// The glasses-style caption block: two lines, always visible, in the
// order a person needs them. HOST is exactly what the speaker says;
// HEARD is exactly what the recognizer captured. The phase strip says
// whose turn it is and never claims LISTENING while the mic is closed.

import {
  captionPhaseLabel,
  heardCaptionLabel,
  heardPlaceholder,
  type CaptionPhase,
  type HeardCaptionState,
} from "../lib/captions";

type CaptionConsoleProps = {
  hostText: string;
  heardText: string;
  heardState: HeardCaptionState;
  phase: CaptionPhase;
  hostHealth: string;
  ack?: string;
  holdText?: string | null;
};

export default function CaptionConsole({
  hostText,
  heardText,
  heardState,
  phase,
  hostHealth,
  ack = "",
  holdText = null,
}: CaptionConsoleProps) {
  const meta = captionPhaseLabel(phase);
  return (
    <div className="caption-console" data-testid="caption-console" data-phase={phase}>
      <div className="caption-row is-host" data-testid="host-prompt" aria-label="Host prompt">
        <span className="caption-tag">HOST</span>
        <p
          className="caption-text"
          data-testid="host-prompt-text"
          data-empty={hostText ? "false" : "true"}
          title={hostText}
        >
          {hostText || "Preparing the next line…"}
        </p>
        <span className="caption-health" data-testid="host-health" data-speaking={hostHealth === "SPEAKING" ? "true" : "false"}>
          {hostHealth}
        </span>
      </div>
      <div className={`caption-row is-heard is-${heardState}`}>
        <span className="caption-tag">{heardCaptionLabel(heardState)}</span>
        <p className="caption-text" data-testid="captions-heard">
          {heardText || heardPlaceholder(phase)}
        </p>
      </div>
      {holdText ? (
        <p className="caption-hold" data-testid="continuation-notice" role="status">
          STILL LISTENING — “{holdText}…” Finish your thought.
        </p>
      ) : null}
      {ack ? (
        <p className="caption-ack" data-testid="host-ack">
          {ack}
        </p>
      ) : null}
      <p className="caption-status" data-testid="caption-phase" data-tone={meta.tone}>
        <span className="caption-phase-label">{meta.label}</span>
        <span className="caption-phase-hint">{meta.hint}</span>
      </p>
    </div>
  );
}

"use client";

// The CONTROLS pop-out: conversation auto-listen, quick example commands,
// sound/voice toggles, and the host voice picker. Presentation only;
// every control calls back into the same Canvas paths that voice uses.

import HostVoicePicker from "./HostVoicePicker";

// One-click example commands for anyone without a mic. Each chip sends its
// command through the same sendToAgent path as typed/voice input —
// sendToAgent paints a live preview instantly (same appliers the agent
// uses), then the agent turn confirms or corrects it.
export const EXAMPLE_COMMANDS = [
  { label: "Pick Mars", command: "Pick Mars as our home base" },
  { label: "Approve Galactic Bagels", command: "Approve Galactic Bagels" },
  { label: "Make Orbit 70%", command: "Make Orbit 70%" },
  { label: "Filing steps & fees", command: "What are the filing steps and fees?" },
  { label: "Prepare lawyer summary", command: "Prepare the lawyer summary" },
] as const;

type Props = {
  convoOn: boolean;
  canSend: boolean;
  soundOn: boolean;
  voiceOn: boolean;
  clockLabel: string;
  shownTranscript: string;
  onClose: () => void;
  onToggleConvo: () => void;
  onChipCommand: (command: string) => void;
  onToggleSound: () => void;
  onToggleVoice: () => void;
  selectHostVoice: (uri: string) => void;
  previewHostVoice: () => void;
};

export default function ControlsPopout({
  convoOn,
  canSend,
  soundOn,
  voiceOn,
  clockLabel,
  shownTranscript,
  onClose,
  onToggleConvo,
  onChipCommand,
  onToggleSound,
  onToggleVoice,
  selectHostVoice,
  previewHostVoice,
}: Props) {
  return (
    <div className="deck-popout" data-testid="dock-popout">
      <div className="popout-head">
        <span className="eyebrow">FLIGHT CONTROLS</span>
        <button type="button" className="link-btn" onClick={onClose}>
          CLOSE
        </button>
      </div>
      <div className="popout-grid">
        <button
          type="button"
          className="btn"
          data-testid="convo-toggle"
          aria-pressed={convoOn}
          onClick={onToggleConvo}
        >
          Conversation auto-listen: {convoOn ? "on" : "off"}
        </button>
        <button
          type="button"
          className="btn"
          data-testid="restart-conversation"
          onClick={() => window.location.reload()}
        >
          Restart conversation
        </button>
      </div>

      <div className="popout-section">
        <span className="eyebrow">QUICK COMMANDS</span>
        <div className="popout-chips">
          {EXAMPLE_COMMANDS.map((chip) => (
            <button
              key={chip.label}
              type="button"
              className="chip-btn"
              data-testid={`example-chip-${chip.label}`}
              disabled={!canSend}
              onClick={() => onChipCommand(chip.command)}
            >
              {chip.label}
            </button>
          ))}
        </div>
      </div>

      <div className="popout-section">
        <span className="eyebrow">VOICE &amp; SOUND</span>
        <div className="popout-grid">
          <button
            type="button"
            className="hud-btn"
            data-testid="sound-toggle"
            aria-pressed={soundOn}
            onClick={onToggleSound}
          >
            <span aria-hidden="true">{soundOn ? "◉" : "○"}</span> SFX
          </button>
          <button
            type="button"
            className="hud-btn"
            data-testid="voice-toggle"
            aria-pressed={voiceOn}
            onClick={onToggleVoice}
          >
            <span aria-hidden="true">{voiceOn ? "◉" : "○"}</span> VOX
          </button>
        </div>
        <HostVoicePicker
          voiceOn={voiceOn}
          onSelect={selectHostVoice}
          onPreview={previewHostVoice}
        />
        <button type="button" className="btn" data-testid="test-voice" onClick={previewHostVoice}>
          TEST VOICE
        </button>
        <p className="popout-clock" aria-label={`Mission clock ${clockLabel}`}>
          MISSION CLOCK T+{clockLabel}
        </p>
      </div>

      <p data-testid="recording-hint" className="micro">
        Say one short command — it paints live as you speak and sends itself when you pause.
        Space starts the mic; 1–6 opens a system panel.
      </p>
      {shownTranscript ? (
        <p data-testid="last-transcript" className="micro">
          Last transcript: <q>{shownTranscript}</q>
        </p>
      ) : null}
    </div>
  );
}

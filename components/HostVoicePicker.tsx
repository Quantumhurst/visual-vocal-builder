"use client";

// Host-voice picker for the controls pop-out.
//
// The host speaks through the browser/OS `speechSynthesis` voice. There
// is no voice model download and no network voice call; this picker lets
// the user choose among the curated English system voices the browser
// exposes. Novelty/character voices are hidden: they exist in the list but
// several are silent or unusable in Chrome, which looks like lost voice.
// The choice is stored by voiceURI (not index) so it survives voice-list
// reordering and OS updates. A stale URI falls back to the curated auto
// pick in lib/voice-select.ts.
//
// This is a separate component so the picker's voice list only mounts
// when Controls is open, and its lazy initial state can read the browser
// voice list without touching SSR or hydration.

import { useEffect, useState } from "react";
import { HOST_VOICE_STORAGE_KEY, selectableVoices } from "../lib/voice-select";

type Props = {
  voiceOn: boolean;
  onSelect: (uri: string) => void;
  onPreview: () => void;
};

function readStoredChoice(): string {
  if (typeof window === "undefined") return "auto";
  try {
    return window.localStorage.getItem(HOST_VOICE_STORAGE_KEY) ?? "auto";
  } catch {
    return "auto";
  }
}

function readVoices(): SpeechSynthesisVoice[] {
  if (typeof window === "undefined" || !window.speechSynthesis) return [];
  return selectableVoices(window.speechSynthesis.getVoices());
}

export default function HostVoicePicker({ voiceOn, onSelect, onPreview }: Props) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(readVoices);
  const [choice, setChoice] = useState<string>(readStoredChoice);

  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const synth = window.speechSynthesis;
    const refresh = () => setVoices(selectableVoices(synth.getVoices()));
    // Some browsers publish the list after first paint; the delayed
    // refresh covers a missed voiceschanged event without a sync setState
    // in the effect body.
    const timer = setTimeout(refresh, 0);
    if (typeof synth.addEventListener === "function") {
      synth.addEventListener("voiceschanged", refresh);
    }
    return () => {
      clearTimeout(timer);
      if (typeof synth.removeEventListener === "function") {
        synth.removeEventListener("voiceschanged", refresh);
      }
    };
  }, []);

  const value =
    choice === "auto" || voices.some((voice) => voice.voiceURI === choice)
      ? choice
      : "auto";

  return (
    <div className="popout-voice">
      <span className="eyebrow">HOST VOICE</span>
      <div className="voice-picker">
        <select
          id="host-voice"
          data-testid="voice-select"
          value={value}
          onChange={(event) => {
            const next = event.target.value;
            setChoice(next);
            onSelect(next);
          }}
          aria-label="Host voice"
        >
          <option value="auto">Auto — best available</option>
          {voices.map((voice) => (
            <option key={voice.voiceURI} value={voice.voiceURI}>
              {voice.name} ({voice.lang})
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn"
          data-testid="voice-preview"
          disabled={!voiceOn}
          onClick={onPreview}
        >
          PREVIEW
        </button>
      </div>
      <p className="micro">Curated browser/OS system voices; novelty voices are hidden. No voice model download.</p>
    </div>
  );
}

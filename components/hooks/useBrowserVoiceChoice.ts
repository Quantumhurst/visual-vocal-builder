"use client";

// Which browser/OS system voice the host uses. The picker stores a
// voiceURI (not an index) so it survives OS updates; a stale URI falls
// back to the curated automatic pick (Karen when the machine has her).
// The storage key lives in lib/voice-select.ts so the picker and the
// speech path agree. The returned API is stable.

import { useRef, useState, type MutableRefObject } from "react";
import {
  HOST_VOICE_STORAGE_KEY,
  defaultHostVoice,
  isSelectableVoice,
  pickVoice,
  resolveVoiceSelection,
} from "../../lib/voice-select";
import { speechQueue } from "../../lib/voice/surviving-speech-queue";

export type BrowserVoiceChoice = {
  // The voice the speech path should use, once resolved.
  cachedVoiceRef: MutableRefObject<SpeechSynthesisVoice | null>;
  // Re-resolve the cached voice from the stored choice and the voices the
  // browser currently publishes.
  refresh: () => void;
  // Store an explicit choice ("auto" or a voiceURI) and apply it now.
  // False when the browser has no speech synthesis.
  select: (uri: string) => boolean;
};

function readStoredVoiceUri(): string | null {
  try {
    const stored = window.localStorage.getItem(HOST_VOICE_STORAGE_KEY);
    const voices = window.speechSynthesis?.getVoices() ?? [];
    // No saved choice: land on Karen when the machine exposes her.
    if (!stored) {
      return defaultHostVoice(voices)?.voiceURI ?? null;
    }
    if (stored === "auto") return null;
    if (voices.length === 0) return stored;
    const chosen = resolveVoiceSelection(voices, stored);
    if (chosen?.voiceURI === stored) return stored;
    // A stale or unreliable saved voice is removed so the next read
    // applies the Karen default rather than leaving the host silent.
    window.localStorage.removeItem(HOST_VOICE_STORAGE_KEY);
    return defaultHostVoice(voices)?.voiceURI ?? null;
  } catch {
    return null;
  }
}

export function useBrowserVoiceChoice(): BrowserVoiceChoice {
  const cachedVoiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const chosenVoiceUriRef = useRef<string | null>(null);

  const [api] = useState<BrowserVoiceChoice>(() => {
    const refresh = () => {
      if (typeof window === "undefined" || !window.speechSynthesis) return;
      const voices = window.speechSynthesis.getVoices();
      let selected = chosenVoiceUriRef.current;
      // Sanitize a stale ref only after the browser has published voices;
      // before that, an empty list would look like every voice vanished.
      if (selected && voices.length > 0 && !voices.some((voice) => voice.voiceURI === selected && isSelectableVoice(voice))) {
        chosenVoiceUriRef.current = null;
        try {
          window.localStorage.removeItem(HOST_VOICE_STORAGE_KEY);
        } catch {
          // Storage is optional.
        }
        selected = null;
      }
      const picked = resolveVoiceSelection(voices, selected ?? readStoredVoiceUri());
      if (picked) {
        // The queue has its own fallback cache. Keep it in step with the
        // curated pick so a missing explicit voice cannot pin an old one.
        if (cachedVoiceRef.current?.voiceURI !== picked.voiceURI) {
          speechQueue.clearCachedVoice();
        }
        cachedVoiceRef.current = picked;
      }
    };

    const select = (uri: string): boolean => {
      if (typeof window === "undefined" || !window.speechSynthesis) return false;
      const list = window.speechSynthesis.getVoices();
      const chosen = uri === "auto" ? pickVoice(list) : resolveVoiceSelection(list, uri);
      const nextUri = uri === "auto" ? "auto" : chosen?.voiceURI ?? "auto";
      chosenVoiceUriRef.current = nextUri === "auto" ? null : nextUri;
      cachedVoiceRef.current = chosen;
      speechQueue.clearCachedVoice();
      try {
        window.localStorage.setItem(HOST_VOICE_STORAGE_KEY, nextUri);
      } catch {
        // Storage is optional; the choice still applies this session.
      }
      return true;
    };

    return { cachedVoiceRef, refresh, select };
  });
  return api;
}

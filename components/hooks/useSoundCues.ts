"use client";

// Synthesised sound cues (no assets; recipes in lib/sound-cues.ts).
// Browsers refuse audio before a user gesture, so cues stay silent until
// the first interaction. The returned function is stable.

import { useRef, useState, type MutableRefObject } from "react";
import { CUES, type CueName } from "../../lib/sound-cues";
import type { VoiceSettings } from "../../lib/voice-controls";

export function useSoundCues(
  settingsRef: MutableRefObject<VoiceSettings>,
  unlockedRef: MutableRefObject<boolean>,
): (name: CueName) => void {
  const ctxRef = useRef<AudioContext | null>(null);

  const [play] = useState(() => (name: CueName) => {
    if (!settingsRef.current.soundOn || settingsRef.current.sound <= 0.01) return;
    if (!unlockedRef.current || typeof window === "undefined") return;
    try {
      const ctx = ctxRef.current ?? new AudioContext();
      ctxRef.current = ctx;
      if (ctx.state === "suspended") void ctx.resume();
      const recipe = CUES[name];
      const t0 = ctx.currentTime;
      for (const note of recipe.notes) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = recipe.type;
        osc.frequency.value = note.freq;
        const start = t0 + note.atMs / 1000;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, 0.14 * settingsRef.current.sound), start + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + note.durMs / 1000);
        osc.connect(gain).connect(ctx.destination);
        osc.start(start);
        osc.stop(start + note.durMs / 1000 + 0.05);
      }
    } catch {
      // Sound is garnish; a failed cue must never break a turn.
    }
  });
  return play;
}

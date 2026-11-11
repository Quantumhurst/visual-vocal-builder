"use client";

// Web Audio playback for the Gemini neural host voice (lib/host-tts.ts
// fetches the audio). Owns the 24 kHz AudioContext, its gain node, and the
// sources that are playing. The API object is created once, so effects
// and callbacks captured on the first render keep working.

import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { pcm16Base64ToFloat32 } from "../../lib/host-tts";
import type { VoiceSettings } from "../../lib/voice-controls";

export type NeuralPlayback = {
  // Stops every line that is playing, without firing its onEnded.
  stop: () => void;
  // Plays one synthesised host line, honouring the spoken volume and speed
  // controls. Resolves with the playing time in ms; null when audio cannot
  // start (no AudioContext, or the browser kept it suspended) so the caller
  // can use the browser voice instead of sitting in silence; or -1 when
  // the line was superseded while waiting.
  play: (base64Data: string, onEnded: () => void, stillWanted: () => boolean) => Promise<number | null>;
  // Stops playback and closes the context (unmount).
  dispose: () => void;
};

const SAMPLE_RATE = 24000;

export function useNeuralPlayback(
  settingsRef: MutableRefObject<VoiceSettings>,
  volume: number,
): NeuralPlayback {
  const ctxRef = useRef<AudioContext | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const sourcesRef = useRef<AudioBufferSourceNode[]>([]);

  // "Louder" / "quieter" apply to a neural line that is already playing.
  useEffect(() => {
    if (gainRef.current) gainRef.current.gain.value = Math.min(1, Math.max(0, volume));
  }, [volume]);

  const [api] = useState<NeuralPlayback>(() => {
    const stop = () => {
      const sources = sourcesRef.current;
      sourcesRef.current = [];
      for (const src of sources) {
        try {
          src.onended = null;
          src.stop();
          src.disconnect();
        } catch {
          // ignore
        }
      }
    };

    const play: NeuralPlayback["play"] = async (base64Data, onEnded, stillWanted) => {
      try {
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!AudioCtx) return null;
        if (!ctxRef.current || ctxRef.current.state === "closed") {
          const created = new AudioCtx({ sampleRate: SAMPLE_RATE });
          const createdGain = created.createGain();
          createdGain.connect(created.destination);
          ctxRef.current = created;
          gainRef.current = createdGain;
        }
        const ctx = ctxRef.current;
        const gain = gainRef.current;
        if (!gain) return null;
        if (ctx.state !== "running") {
          await Promise.race([
            ctx.resume().catch(() => undefined),
            new Promise((resolve) => setTimeout(resolve, 400)),
          ]);
          if ((ctx.state as AudioContextState) !== "running") return null;
          if (!stillWanted()) return -1;
        }
        const samples = pcm16Base64ToFloat32(base64Data);
        if (samples.length === 0) return null;
        const buffer = ctx.createBuffer(1, samples.length, SAMPLE_RATE);
        buffer.getChannelData(0).set(samples);
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        const rate = Math.min(1.6, Math.max(0.5, settingsRef.current.rate));
        source.playbackRate.value = rate;
        gain.gain.value = Math.min(1, Math.max(0, settingsRef.current.volume));
        source.connect(gain);
        source.onended = () => {
          const idx = sourcesRef.current.indexOf(source);
          if (idx >= 0) sourcesRef.current.splice(idx, 1);
          onEnded();
        };
        sourcesRef.current.push(source);
        source.start();
        return (buffer.duration / rate) * 1000;
      } catch (err) {
        console.warn("[host-voice] neural playback error:", err);
        return null;
      }
    };

    const dispose = () => {
      stop();
      const ctx = ctxRef.current;
      ctxRef.current = null;
      gainRef.current = null;
      if (ctx && ctx.state !== "closed") void ctx.close().catch(() => undefined);
    };

    return { stop, play, dispose };
  });
  return api;
}

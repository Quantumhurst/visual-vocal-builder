"use client";

// The microphone as hardware: getUserMedia, a 16 kHz AudioContext, the
// PCM capture worklet, and the buffered audio of the current turn. It
// makes no turn decisions — when a turn ends, or that nobody spoke, is
// the caller's call (onBlock). The returned API is stable.
//
// Every captured block is:
//   dropped while the turn is not listening, or while the host is audible
//     (the mic never hears the host);
//   kept for the buffered transcription fallback;
//   sent as PCM16 to the live speech socket when one is open;
//   measured (level, peak) and handed to onBlock.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { rmsLevel } from "../../lib/live-intent";
import { loadPcmWorklet } from "../../lib/mic";
import { toPcm16k } from "../../lib/pcm";

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export type MicBlock = {
  level: number;
  now: number;
  // Sample rate of the capture context (0 if unknown).
  rate: number;
  // Duration of this block in ms.
  blockMs: number;
};

export type MicCaptureDeps = {
  // The current turn is listening (the mic is open for words).
  isListening: () => boolean;
  // Host audio is playing; capture is gated to avoid self-echo.
  isHostAudible: () => boolean;
  // The live speech socket, when one is open.
  streamSocket: () => WebSocket | null;
  // One kept block, after it is buffered and streamed.
  onBlock: (block: MicBlock) => void;
};

export type MicStats = { blocks: number; hostDropped: number; listeningDropped: number };

export type MicCapture = {
  // Start (or resume) the pipeline. Throws when the mic cannot be opened.
  ensure: () => Promise<void>;
  // Tear the pipeline down and release the microphone.
  stop: () => void;
  // The turn's buffered audio and its sample rate; the buffer is cleared.
  takeBuffered: () => { chunks: Float32Array[]; rate: number };
  discardBuffered: () => void;
  // Size of the buffered audio once converted to 16 kHz PCM16.
  bufferedPcmBytes: () => number;
  level: () => number;
  peak: () => number;
  // A new turn: clear the buffer, the meters, and the counters.
  resetTurn: () => void;
  stats: () => MicStats;
};

function toPcm16(block: Float32Array, rate: number): Int16Array {
  if (rate === 16000) {
    const pcm = new Int16Array(block.length);
    for (let i = 0; i < block.length; i++) {
      const s = Math.max(-1, Math.min(1, block[i]));
      pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return pcm;
  }
  return rate > 0 ? toPcm16k(block, rate) : new Int16Array(0);
}

export function useMicCapture(deps: MicCaptureDeps): MicCapture {
  const depsRef = useRef(deps);
  useIsomorphicLayoutEffect(() => {
    depsRef.current = deps;
  });

  const [api] = useState<MicCapture>(() => {
    let ctx: AudioContext | null = null;
    let stream: MediaStream | null = null;
    let worklet: AudioWorkletNode | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let chunks: Float32Array[] = [];
    let level = 0;
    let peak = 0;
    let stats: MicStats = { blocks: 0, hostDropped: 0, listeningDropped: 0 };

    const onMessage = (event: MessageEvent) => {
      const d = depsRef.current;
      const block = event.data as Float32Array;
      if (!block || block.length === 0) return;
      if (!d.isListening()) {
        stats.listeningDropped += 1;
        return;
      }
      // Mic gated during host playback to eliminate acoustic self-echo.
      if (d.isHostAudible()) {
        stats.hostDropped += 1;
        return;
      }
      stats.blocks += 1;
      chunks.push(block);
      const rate = ctx?.sampleRate ?? 0;

      // Stream binary PCM16 to the live speech relay when it is open.
      const socket = d.streamSocket();
      if (socket && socket.readyState === WebSocket.OPEN) {
        const pcm = toPcm16(block, rate);
        if (pcm.length > 0) socket.send(pcm.buffer);
      }

      level = rmsLevel(block);
      peak = Math.max(peak, level);
      d.onBlock({ level, now: performance.now(), rate, blockMs: rate > 0 ? (block.length / rate) * 1000 : 0 });
    };

    const ensure = async () => {
      if (ctx && stream && worklet) {
        if (ctx.state === "suspended") await ctx.resume();
        return;
      }
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      let created: AudioContext;
      try {
        created = new AudioContext({ sampleRate: 16000 });
      } catch {
        created = new AudioContext();
      }
      ctx = created;
      await loadPcmWorklet((url) => created.audioWorklet.addModule(url));
      worklet = new AudioWorkletNode(created, "pcm-capture");
      worklet.port.onmessage = onMessage;
      source = created.createMediaStreamSource(stream);
      source.connect(worklet);
      if (created.state === "suspended") await created.resume();
    };

    const stop = () => {
      try {
        worklet?.disconnect();
      } catch {
        // ignore
      }
      try {
        if (worklet) worklet.port.onmessage = null;
      } catch {
        // ignore
      }
      worklet = null;
      try {
        source?.disconnect();
      } catch {
        // ignore
      }
      source = null;
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
      const closing = ctx;
      ctx = null;
      if (closing && closing.state !== "closed") void closing.close().catch(() => undefined);
    };

    return {
      ensure,
      stop,
      takeBuffered: () => {
        const taken = chunks;
        chunks = [];
        return { chunks: taken, rate: ctx?.sampleRate ?? 0 };
      },
      discardBuffered: () => {
        chunks = [];
      },
      bufferedPcmBytes: () => {
        const rate = ctx?.sampleRate ?? 0;
        if (rate <= 0) return 0;
        const total = chunks.reduce((sum, c) => sum + c.length, 0);
        return Math.round(total / (rate / 16000)) * 2;
      },
      level: () => level,
      peak: () => peak,
      resetTurn: () => {
        chunks = [];
        level = 0;
        peak = 0;
        stats = { blocks: 0, hostDropped: 0, listeningDropped: 0 };
      },
      stats: () => ({ ...stats }),
    };
  });
  return api;
}

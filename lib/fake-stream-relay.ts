// Offline stand-in for the Meta realtime speech relay (VOICE_PROVIDER=
// fake-meta). It speaks the same protocol to the browser as
// lib/meta-stream-relay.ts, so the app's Meta streaming path — socket,
// partials, the hybrid endpointer's fast commits, speechComplete, the
// duplicate-final tombstones — runs for real in the headset walk.
//
// It cannot recognise speech. It finds where speech starts and ends from
// the audio level (in audio time, so it is deterministic), and the words
// are the line the walk posted to /api/fake (lib/fake-provider.ts):
//
//   ready                                  on connect
//   speechStart {turnId}                   when speech begins
//   transcript {transcript, final: false}  after 300 ms of speech (Meta
//                                          sends partials while you talk)
//   speechEnd {turnId}, then
//   speechComplete {transcript, turnId}    after 700 ms of silence
//
// Like the real relay, `transcript` carries no turnId.

import type WebSocket from "ws";
import { peekTranscript, takeTranscript } from "./fake-provider.ts";

const SAMPLE_RATE = 16000;
export const FAKE_SPEECH_RMS = 0.01;
export const FAKE_PARTIAL_AFTER_MS = 300;
export const FAKE_END_SILENCE_MS = 700;

export type FakeRelayEvent =
  | { type: "ready"; sessionId: string }
  | { type: "speechStart"; turnId: number; audioProcessedMs: number }
  | { type: "transcript"; transcript: string; final: false; audioProcessedMs: number }
  | { type: "speechEnd"; turnId: number; audioProcessedMs: number }
  | { type: "speechComplete"; transcript: string; turnId: number; audioProcessedMs: number }
  | { type: "pong" };

function rmsOf(pcm: Buffer): number {
  const count = Math.floor(pcm.length / 2);
  if (count === 0) return 0;
  let sumSq = 0;
  for (let i = 0; i < count; i++) {
    const v = pcm.readInt16LE(i * 2) / 32768;
    sumSq += v * v;
  }
  return Math.sqrt(sumSq / count);
}

// The endpointing, separate from the socket so it is unit-testable.
export function createFakeEndpointer(emit: (event: FakeRelayEvent) => void) {
  let processedMs = 0;
  let turnId = 0;
  let speaking = false;
  let speechMs = 0;
  let silenceMs = 0;
  let partialSent = false;

  return {
    // One PCM16 16 kHz mono frame from the browser.
    audio(pcm: Buffer) {
      const frameMs = (Math.floor(pcm.length / 2) / SAMPLE_RATE) * 1000;
      processedMs += frameMs;
      const loud = rmsOf(pcm) >= FAKE_SPEECH_RMS;
      if (!speaking) {
        if (!loud) return;
        speaking = true;
        turnId += 1;
        speechMs = frameMs;
        silenceMs = 0;
        partialSent = false;
        emit({ type: "speechStart", turnId, audioProcessedMs: Math.round(processedMs) });
        return;
      }
      if (loud) {
        speechMs += frameMs;
        silenceMs = 0;
      } else {
        silenceMs += frameMs;
      }
      if (!partialSent && speechMs >= FAKE_PARTIAL_AFTER_MS) {
        partialSent = true;
        const words = peekTranscript();
        if (words) emit({ type: "transcript", transcript: words, final: false, audioProcessedMs: Math.round(processedMs) });
      }
      if (silenceMs >= FAKE_END_SILENCE_MS) {
        speaking = false;
        const at = Math.round(processedMs);
        emit({ type: "speechEnd", turnId, audioProcessedMs: at });
        emit({ type: "speechComplete", transcript: takeTranscript(), turnId, audioProcessedMs: at });
      }
    },
  };
}

export function handleFakeStreamClient(clientWs: WebSocket) {
  const send = (event: FakeRelayEvent) => {
    if (clientWs.readyState === clientWs.OPEN) clientWs.send(JSON.stringify(event));
  };
  const endpointer = createFakeEndpointer(send);
  clientWs.on("message", (data: WebSocket.RawData, isBinary: boolean) => {
    if (isBinary) {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
      endpointer.audio(buf);
      return;
    }
    try {
      const msg = JSON.parse(data.toString()) as { type?: string };
      if (msg.type === "ping") send({ type: "pong" });
    } catch {
      // ignore non-json text
    }
  });
  send({ type: "ready", sessionId: "offline-test" });
}

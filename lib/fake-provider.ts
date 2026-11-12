// Offline test providers (VOICE_PROVIDER=fake, fake-meta) — no network,
// no key. fake-meta also answers the realtime streaming socket
// (lib/fake-stream-relay.ts) with the same expected line.
//
// The headset walk drives the real app (real microphone pipeline, real
// turn-taking, re-arm and slow-speech hold) with synthesised audio. In
// fake mode only the outside services are replaced:
//
// - Speech-to-text: the walk knows what each clip says, so it posts the
//   text to /api/fake just before playing it. Transcribing any non-silent
//   audio returns that text once. Silence still returns "", so no-speech
//   handling is exercised for real. The slot holds one line (latest wins):
//   if the app ever skipped a transcription, the next utterance still gets
//   its own words instead of every later turn shifting by one.
// - Agent: a minimal model that answers with one fixed line and calls no
//   tools. The journey's commands are handled by the local fast lane, so
//   the walk does not depend on model output.
// - Host voice: none server-side; the browser voice speaks (as for Meta).
//
// It is selected only by an explicit VOICE_PROVIDER=fake, never by key
// detection, and /api/fake answers 404 in every other mode.

import { isBufferSilent } from "./gemini-asr.ts";

export const FAKE_AGENT_REPLY = "Offline test mode — say the command on the card.";
export const MAX_FAKE_TRANSCRIPT_CHARS = 500;

// Next bundles each route separately; globalThis is the one place every
// route in this server process shares.
type FakeSlot = { next: string | null };
const SLOT_KEY = "__vvbFakeTranscript";

function slot(): FakeSlot {
  const g = globalThis as unknown as Record<string, FakeSlot | undefined>;
  if (!g[SLOT_KEY]) g[SLOT_KEY] = { next: null };
  return g[SLOT_KEY];
}

export function expectTranscript(text: string): void {
  slot().next = text.trim().slice(0, MAX_FAKE_TRANSCRIPT_CHARS) || null;
}

export function clearExpectedTranscript(): void {
  slot().next = null;
}

// The expected line without using it up (partial transcripts).
export function peekTranscript(): string {
  return slot().next ?? "";
}

export function takeTranscript(): string {
  const s = slot();
  const text = s.next ?? "";
  s.next = null;
  return text;
}

export async function fakeTranscribePcm(pcm: Buffer): Promise<string> {
  if (isBufferSilent(pcm)) return "";
  return takeTranscript();
}

// A minimal AI SDK language model (specification v3) that streams one
// fixed line. Structural: the route checks it against the real model type.
const usage = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
};
const finishReason = { unified: "stop" as const, raw: "stop" };

export function createFakeBrain() {
  return {
    specificationVersion: "v3" as const,
    provider: "vvb-fake",
    modelId: "offline-test",
    supportedUrls: {},
    async doGenerate() {
      return {
        content: [{ type: "text" as const, text: FAKE_AGENT_REPLY }],
        finishReason,
        usage,
        warnings: [],
      };
    },
    async doStream() {
      const parts = [
        { type: "stream-start" as const, warnings: [] },
        { type: "text-start" as const, id: "t0" },
        { type: "text-delta" as const, id: "t0", delta: FAKE_AGENT_REPLY },
        { type: "text-end" as const, id: "t0" },
        { type: "finish" as const, usage, finishReason },
      ];
      return {
        stream: new ReadableStream<(typeof parts)[number]>({
          start(controller) {
            for (const part of parts) controller.enqueue(part);
            controller.close();
          },
        }),
      };
    },
  };
}

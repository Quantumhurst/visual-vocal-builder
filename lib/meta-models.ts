import { ASR_KEYWORDS } from "./asr-vocabulary.ts";

// Meta Model API model choices — one place, unit-testable.
//
// Audit (dev.meta.ai/docs/models, checked 2026-11-02):
// - Brain: muse-spark-1.3 is the latest Spark and "Recommended for new
//   work" for agentic tool loops. Muse Wonder (muse-wonder-1.0) is more
//   capable but built for long-horizon coding / computer use and is
//   preview + higher latency/cost; Meta's own guidance puts Spark on
//   "high-volume, latency-sensitive, or cost-sensitive work, such as
//   tight tool loops" — exactly this voice loop. Spark stays.
// - Speech: muse-voice-transcribe-1.0 is Meta's only STT model. It was
//   already in use, but without the vocabulary/language biasing the
//   model offers — the handshake below fixes that so demo words like
//   "Europa" and "Galactic Bagels" are recognised instead of guessed at.
// - Muse Image / SAM 3.1 / Glimmer / Spark Open: no image-generation,
//   segmentation, or self-hosting need in this app; not adopted.

export const BRAIN_MODEL = "muse-spark-1.3";
export const ASR_MODEL = "muse-voice-transcribe-1.0";

// Domain vocabulary lives in lib/asr-vocabulary.ts (shared with the
// Gemini transcriber). For Meta it is handshake-only keyword biasing: it
// cannot change mid-session, per the speech-to-text docs.
export { ASR_KEYWORDS };

export const ASR_LANGUAGE_BIAS = ["English"] as const;

export function buildAsrHandshake(apiKey: string) {
  return {
    authorization: { accessToken: `Bearer ${apiKey}` },
    audioEncoding: "PCM_16KHZ",
    model: ASR_MODEL,
    // ENDPOINTING (not DIARIZATION): model-detected turn boundaries for
    // low-latency voice commands. CUMULATIVE partials replace, not append.
    mode: "ENDPOINTING",
    partialMode: "CUMULATIVE",
    emitAudioProgress: false,
    keywords: [...ASR_KEYWORDS],
    languageBias: [...ASR_LANGUAGE_BIAS],
  };
}

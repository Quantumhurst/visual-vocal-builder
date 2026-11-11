// Which model provider drives the voice loop — one place, unit-testable.
//
// The guided loop is the same for both providers: speech is transcribed,
// the brain decides (local fast lane first, then the agent), and the host
// speaks its scripted line. A provider only supplies the three engines:
//
//            ears (speech-to-text)            brain            host voice
//   gemini   browser recogniser + buffered    gemini-2.5-flash Gemini neural voice,
//            gemini-2.5-flash transcription                    browser voice fallback
//   meta     Muse Voice Transcribe, realtime  muse-spark-1.3   browser voice
//            streaming + buffered fallback
//
// Select with VOICE_PROVIDER=gemini|meta. When it is unset the provider is
// whichever key is present; Gemini wins when both are.

export type VoiceProvider = "gemini" | "meta";

export const PROVIDERS: readonly VoiceProvider[] = ["gemini", "meta"];

export const PROVIDER_KEY_ENV: Record<VoiceProvider, "GEMINI_API_KEY" | "META_API_KEY"> = {
  gemini: "GEMINI_API_KEY",
  meta: "META_API_KEY",
};

export type ProviderResolution =
  | { ok: true; provider: VoiceProvider; apiKey: string; source: "explicit" | "auto" }
  | { ok: false; provider: VoiceProvider | null; error: string };

type Env = Record<string, string | undefined>;

function keyFor(env: Env, provider: VoiceProvider): string {
  return (env[PROVIDER_KEY_ENV[provider]] ?? "").trim();
}

export function resolveProvider(env: Env = process.env): ProviderResolution {
  const requested = (env.VOICE_PROVIDER ?? "").trim().toLowerCase();
  if (requested) {
    if (requested !== "gemini" && requested !== "meta") {
      return { ok: false, provider: null, error: "VOICE_PROVIDER must be \"gemini\" or \"meta\"" };
    }
    const apiKey = keyFor(env, requested);
    if (!apiKey) {
      return {
        ok: false,
        provider: requested,
        error: `${PROVIDER_KEY_ENV[requested]} is not configured on the server`,
      };
    }
    return { ok: true, provider: requested, apiKey, source: "explicit" };
  }
  for (const provider of PROVIDERS) {
    const apiKey = keyFor(env, provider);
    if (apiKey) return { ok: true, provider, apiKey, source: "auto" };
  }
  return {
    ok: false,
    provider: null,
    error: "GEMINI_API_KEY or META_API_KEY is not configured on the server",
  };
}

// What the browser needs to know. Never includes a key.
export type ProviderInfo = {
  provider: VoiceProvider;
  // Realtime streaming speech-to-text over /api/asr-stream.
  streamingAsr: boolean;
  // Server-synthesised host voice over /api/tts.
  neuralVoice: boolean;
  label: string;
};

export function providerInfo(provider: VoiceProvider): ProviderInfo {
  return provider === "meta"
    ? { provider, streamingAsr: true, neuralVoice: false, label: "Meta Muse" }
    : { provider, streamingAsr: false, neuralVoice: true, label: "Google Gemini" };
}

// Used before /api/provider answers, and when it cannot be reached. It
// only uses engines every provider and browser has: buffered
// transcription and the browser voice.
export const SAFE_PROVIDER_INFO: ProviderInfo = {
  provider: "gemini",
  streamingAsr: false,
  neuralVoice: false,
  label: "",
};

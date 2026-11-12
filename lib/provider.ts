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
//
// VOICE_PROVIDER=fake and fake-meta are the offline test modes
// (lib/fake-provider.ts): no key, no network. fake is shaped like Gemini
// (buffered speech-to-text); fake-meta like Meta (the realtime streaming
// socket, answered by lib/fake-stream-relay.ts). Neither is ever chosen
// automatically.

export type KeyedProvider = "gemini" | "meta";
export type OfflineProvider = "fake" | "fake-meta";
export type VoiceProvider = KeyedProvider | OfflineProvider;

export function isOfflineProvider(provider: VoiceProvider): provider is OfflineProvider {
  return provider === "fake" || provider === "fake-meta";
}

// The providers chosen automatically from the keys present, in order.
export const PROVIDERS: readonly KeyedProvider[] = ["gemini", "meta"];

export const PROVIDER_KEY_ENV: Record<KeyedProvider, "GEMINI_API_KEY" | "META_API_KEY"> = {
  gemini: "GEMINI_API_KEY",
  meta: "META_API_KEY",
};

export type ProviderResolution =
  | { ok: true; provider: VoiceProvider; apiKey: string; source: "explicit" | "auto" }
  | { ok: false; provider: VoiceProvider | null; error: string };

type Env = Record<string, string | undefined>;

function keyFor(env: Env, provider: KeyedProvider): string {
  return (env[PROVIDER_KEY_ENV[provider]] ?? "").trim();
}

export function resolveProvider(env: Env = process.env): ProviderResolution {
  const requested = (env.VOICE_PROVIDER ?? "").trim().toLowerCase();
  if (requested) {
    if (requested === "fake" || requested === "fake-meta") {
      return { ok: true, provider: requested, apiKey: "", source: "explicit" };
    }
    if (requested !== "gemini" && requested !== "meta") {
      return { ok: false, provider: null, error: "VOICE_PROVIDER must be \"gemini\", \"meta\", \"fake\" or \"fake-meta\"" };
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

// What the browser needs to know. Never includes a key. `provider` is the
// client code path: fake-meta reports "meta" so the browser runs exactly
// the Meta path; `offline` says a test mode is answering.
export type ClientProvider = KeyedProvider | "fake";
export type ProviderInfo = {
  provider: ClientProvider;
  // Realtime streaming speech-to-text over /api/asr-stream.
  streamingAsr: boolean;
  // Server-synthesised host voice over /api/tts.
  neuralVoice: boolean;
  label: string;
  offline: boolean;
};

export function providerInfo(provider: VoiceProvider): ProviderInfo {
  if (provider === "meta") return { provider, streamingAsr: true, neuralVoice: false, label: "Meta Muse", offline: false };
  if (provider === "fake-meta") {
    return { provider: "meta", streamingAsr: true, neuralVoice: false, label: "Offline test (Meta streaming)", offline: true };
  }
  if (provider === "fake") return { provider, streamingAsr: false, neuralVoice: false, label: "Offline test", offline: true };
  return { provider, streamingAsr: false, neuralVoice: true, label: "Google Gemini", offline: false };
}

// Used before /api/provider answers, and when it cannot be reached. It
// only uses engines every provider and browser has: buffered
// transcription and the browser voice.
export const SAFE_PROVIDER_INFO: ProviderInfo = {
  provider: "gemini",
  streamingAsr: false,
  neuralVoice: false,
  label: "",
  offline: false,
};

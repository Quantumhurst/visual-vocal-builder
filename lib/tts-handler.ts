// Host voice synthesis (/api/tts) — validation, caching and the upstream
// call, kept out of the route so it is unit-testable without a network.

import { checkOrigin, clientKey, createRateLimiter } from "./request-guard.ts";
import type { ProviderResolution } from "./provider.ts";

export const TTS_MODEL = "gemini-2.5-flash-preview-tts";
export const DEFAULT_TTS_VOICE = "Aoede";
// Prebuilt Gemini voices this app may request. Anything else is refused,
// so a caller cannot pass arbitrary strings through to the upstream API.
export const TTS_VOICES = ["Aoede", "Charon", "Fenrir", "Kore", "Leda", "Orus", "Puck", "Zephyr"] as const;
// The longest thing the host says is the spoken lawyer summary. Past this
// the request is abuse, not a host line.
export const MAX_TTS_CHARS = 1500;
export const TTS_SAMPLE_RATE = 24000;
const MAX_CACHE_ENTRIES = 100;
const UPSTREAM_TIMEOUT_MS = 10_000;

export type TtsAudio = { audio: string; sampleRate: number };

export type TtsDeps = {
  resolve: () => ProviderResolution;
  synthesize?: (text: string, voice: string, apiKey: string) => Promise<TtsAudio>;
  limiter?: ReturnType<typeof createRateLimiter>;
  cache?: Map<string, TtsAudio>;
  inflight?: Map<string, Promise<TtsAudio>>;
  log?: (message: string) => void;
};

const defaultLimiter = createRateLimiter({ limit: 90, windowMs: 60_000 });
const defaultCache = new Map<string, TtsAudio>();
const defaultInflight = new Map<string, Promise<TtsAudio>>();

export async function synthesizeWithGemini(text: string, voice: string, apiKey: string): Promise<TtsAudio> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${TTS_MODEL}:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    // The key travels in a header, never in the URL, so it cannot end up
    // in an error message or a proxy log.
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    body: JSON.stringify({
      contents: [{ parts: [{ text }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
      },
    }),
  });
  if (!res.ok) throw new Error(`upstream status ${res.status}`);
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string } }> } }>;
  };
  const audio = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData?.data;
  if (!audio) throw new Error("upstream returned no audio");
  return { audio, sampleRate: TTS_SAMPLE_RATE };
}

export async function handleTts(req: Request, deps: TtsDeps): Promise<Response> {
  const limiter = deps.limiter ?? defaultLimiter;
  const cache = deps.cache ?? defaultCache;
  const inflight = deps.inflight ?? defaultInflight;
  const synthesize = deps.synthesize ?? synthesizeWithGemini;
  const log = deps.log ?? ((message: string) => console.warn(`[tts] ${message}`));

  if (!checkOrigin(req.headers.get("origin"), req.headers.get("host"), { requireOrigin: true })) {
    return Response.json({ error: "forbidden origin" }, { status: 403 });
  }
  const rl = limiter(clientKey(req));
  if (!rl.ok) {
    return Response.json({ error: "rate limited" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
  }

  // Validate the request before looking at configuration, so a bad
  // request is a 400 whatever the server's keys are.
  let body: { text?: unknown; voice?: unknown };
  try {
    body = (await req.json()) as { text?: unknown; voice?: unknown };
  } catch {
    return Response.json({ error: "invalid json body" }, { status: 400 });
  }
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return Response.json({ error: "missing text" }, { status: 400 });
  if (text.length > MAX_TTS_CHARS) return Response.json({ error: "text too long" }, { status: 413 });
  const voice = body.voice === undefined || body.voice === null || body.voice === "" ? DEFAULT_TTS_VOICE : body.voice;
  if (typeof voice !== "string" || !(TTS_VOICES as readonly string[]).includes(voice)) {
    return Response.json({ error: "unknown voice" }, { status: 400 });
  }

  const resolved = deps.resolve();
  if (!resolved.ok) return Response.json({ error: resolved.error }, { status: 500 });
  if (resolved.provider !== "gemini") {
    // The client falls back to the browser voice on any non-2xx.
    return Response.json({ error: "neural voice is not available for this provider" }, { status: 501 });
  }

  const key = `${voice}:${text}`;
  const cached = cache.get(key);
  if (cached) {
    // Refresh recency so the lines the host keeps repeating stay cached.
    cache.delete(key);
    cache.set(key, cached);
    return Response.json({ ...cached, cached: true });
  }

  // A prefetch and the real request for the same line share one upstream call.
  let pending = inflight.get(key);
  if (!pending) {
    pending = synthesize(text, voice, resolved.apiKey).finally(() => inflight.delete(key));
    inflight.set(key, pending);
  }
  try {
    const result = await pending;
    if (cache.size >= MAX_CACHE_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(key, result);
    return Response.json({ ...result, cached: false });
  } catch (err) {
    // Upstream detail stays in the server log; the browser gets a plain line.
    log(err instanceof Error ? err.message : String(err));
    return Response.json({ error: "voice synthesis failed" }, { status: 502 });
  }
}

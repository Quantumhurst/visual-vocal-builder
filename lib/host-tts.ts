// Browser-side cache for the neural host voice (/api/tts).
//
// The host's next line is almost always known before it is spoken — the
// next mission question is on screen while the user is still answering —
// so it is fetched ahead of time. When the line is due its audio is
// usually already here and speech starts without a network wait. A speak
// and a prefetch for the same line share one request.

export const NEURAL_VOICE = "Aoede";
// How long a line that is due may wait for neural audio before the
// browser voice says it instead. Silence is worse than a different voice.
export const NEURAL_VOICE_WAIT_MS = 2500;
// When the server answers 429 (the voice quota is spent) without saying
// how long to wait.
export const QUOTA_PAUSE_DEFAULT_MS = 60_000;

type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  headers?: { get: (name: string) => string | null };
}>;

export type HostTts = {
  // Resolves with base64 PCM16 (24 kHz mono). Rejects when unavailable.
  get: (text: string) => Promise<string>;
  prefetch: (text: string) => void;
  has: (text: string) => boolean;
  // True once the server has said it has no neural voice; callers stop asking.
  unavailable: () => boolean;
  // True while the voice quota is spent. New lines are refused at once (so
  // the browser voice speaks without waiting); cached lines still play.
  pausedForQuota: () => boolean;
};

export function createHostTts(
  options: { fetchImpl?: FetchLike; maxEntries?: number; voice?: string; now?: () => number } = {},
): HostTts {
  const doFetch: FetchLike = options.fetchImpl ?? ((url, init) => fetch(url, init));
  const maxEntries = options.maxEntries ?? 48;
  const voice = options.voice ?? NEURAL_VOICE;
  const cache = new Map<string, string>();
  const inflight = new Map<string, Promise<string>>();
  let unavailable = false;
  const now = options.now ?? (() => Date.now());
  let pausedUntil = 0;
  const paused = () => now() < pausedUntil;

  function get(text: string): Promise<string> {
    const key = text.trim();
    if (!key) return Promise.reject(new Error("empty line"));
    const hit = cache.get(key);
    if (hit) {
      cache.delete(key);
      cache.set(key, hit);
      return Promise.resolve(hit);
    }
    if (unavailable) return Promise.reject(new Error("neural voice unavailable"));
    if (paused()) return Promise.reject(new Error("neural voice paused for quota"));
    const running = inflight.get(key);
    if (running) return running;
    const request = (async () => {
      const res = await doFetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: key, voice }),
      });
      if (!res.ok) {
        // 501: this provider has no neural voice. 500: no key. Neither
        // will change mid-session, so stop asking.
        if (res.status === 501 || res.status === 500) unavailable = true;
        // 429: the voice quota is spent. Stop asking until it refills.
        if (res.status === 429) {
          const sec = Number(res.headers?.get("retry-after") ?? "");
          const waitMs = Number.isFinite(sec) && sec > 0 ? sec * 1000 : QUOTA_PAUSE_DEFAULT_MS;
          pausedUntil = Math.max(pausedUntil, now() + waitMs);
        }
        throw new Error(`TTS status ${res.status}`);
      }
      const data = (await res.json()) as { audio?: unknown };
      if (typeof data.audio !== "string" || !data.audio) throw new Error("no audio payload");
      if (cache.size >= maxEntries) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
      cache.set(key, data.audio);
      return data.audio;
    })().finally(() => inflight.delete(key));
    inflight.set(key, request);
    return request;
  }

  return {
    get,
    prefetch: (text) => {
      if (unavailable || paused() || !text.trim()) return;
      void get(text).catch(() => undefined);
    },
    has: (text) => cache.has(text.trim()),
    unavailable: () => unavailable,
    pausedForQuota: paused,
  };
}

// One cache for the page: the landing prompt and the cockpit share it.
export const hostTts = createHostTts();

// Resolves with the value, or rejects after `ms`. The underlying work is
// not cancelled: a late neural line still lands in the cache for next time.
export function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("deadline")), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

// base64 PCM16 little-endian → Float32 samples in [-1, 1).
export function pcm16Base64ToFloat32(base64: string): Float32Array {
  const binary = atob(base64);
  const len = Math.floor(binary.length / 2);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const lo = binary.charCodeAt(i * 2);
    const hi = binary.charCodeAt(i * 2 + 1);
    const sample = (hi << 8) | lo;
    out[i] = (sample >= 0x8000 ? sample - 0x10000 : sample) / 32768;
  }
  return out;
}

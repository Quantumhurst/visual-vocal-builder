import { checkOrigin, createRateLimiter, clientKey } from "../../../lib/request-guard.ts";

const TTS_MODEL = "gemini-2.5-flash-preview-tts";
const DEFAULT_VOICE = "Aoede";

// In-memory cache for synthesized voice lines (common prompts, greetings)
const audioCache = new Map<string, { audio: string; sampleRate: number }>();
const MAX_CACHE_ENTRIES = 100;

const limiter = createRateLimiter({ limit: 60, windowMs: 60_000 });

export async function POST(req: Request): Promise<Response> {
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (!checkOrigin(origin, host)) {
    return Response.json({ error: "forbidden origin" }, { status: 403 });
  }

  const rl = limiter(clientKey(req));
  if (!rl.ok) {
    return Response.json(
      { error: "rate limited" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 });
  }

  let body: { text?: string; voice?: string };
  try {
    body = (await req.json()) as { text?: string; voice?: string };
  } catch {
    return Response.json({ error: "invalid json body" }, { status: 400 });
  }

  const text = (body.text || "").trim();
  if (!text) {
    return Response.json({ error: "missing text" }, { status: 400 });
  }

  const voice = body.voice || DEFAULT_VOICE;
  const cacheKey = `${voice}:${text}`;

  const cached = audioCache.get(cacheKey);
  if (cached) {
    return Response.json({ audio: cached.audio, sampleRate: cached.sampleRate, cached: true });
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${TTS_MODEL}:generateContent?key=${apiKey}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: voice,
              },
            },
          },
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return Response.json(
        { error: `Gemini TTS failed with status ${res.status}: ${errText}` },
        { status: res.status },
      );
    }

    const data = (await res.json()) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{
            inlineData?: {
              mimeType: string;
              data: string;
            };
          }>;
        };
      }>;
    };

    const part = data.candidates?.[0]?.content?.parts?.[0];
    const audioData = part?.inlineData?.data;

    if (!audioData) {
      return Response.json({ error: "Gemini TTS returned no audio data" }, { status: 502 });
    }

    if (audioCache.size >= MAX_CACHE_ENTRIES) {
      const firstKey = audioCache.keys().next().value;
      if (firstKey) audioCache.delete(firstKey);
    }
    audioCache.set(cacheKey, { audio: audioData, sampleRate: 24000 });

    return Response.json({
      audio: audioData,
      sampleRate: 24000,
      cached: false,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: `Gemini TTS request failed: ${message}` }, { status: 500 });
  }
}

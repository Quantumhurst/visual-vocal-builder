import { MAX_PCM_BYTES, checkOrigin, clientKey, createRateLimiter } from "./request-guard.ts";

export type TranscribeDeps = {
  transcribe: (pcm: Buffer) => Promise<string>;
  limiter?: ReturnType<typeof createRateLimiter>;
  // Which provider did the work; only used to label the server log line.
  provider?: string;
  log?: (entry: { audioBytes: number; transcriptLength: number }) => void;
  logError?: (message: string) => void;
};

const defaultLimiter = createRateLimiter({ limit: 20, windowMs: 60_000 });

export async function handleTranscribe(req: Request, deps: TranscribeDeps): Promise<Response> {
  const limiter = deps.limiter ?? defaultLimiter;
  const log = deps.log ?? ((entry: { audioBytes: number; transcriptLength: number }) => console.log(`${deps.provider ?? "asr"} transcribe call`, entry));
  const logError = deps.logError ?? ((message: string) => console.warn(`[transcribe] ${message}`));

  if (!checkOrigin(req.headers.get("origin"), req.headers.get("host"), { requireOrigin: true })) {
    return Response.json({ error: "forbidden origin" }, { status: 403 });
  }
  const rl = limiter(clientKey(req));
  if (!rl.ok) {
    return Response.json({ error: "rate limited" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
  }
  const cl = req.headers.get("content-length");
  if (cl) {
    const n = Number(cl);
    if (Number.isFinite(n) && n > MAX_PCM_BYTES + 4096) {
      return Response.json({ error: "payload too large" }, { status: 413 });
    }
  }
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "expected multipart form data" }, { status: 400 });
  }
  const audio = form.get("audio");
  if (!(audio instanceof Blob)) {
    return Response.json({ error: "missing 'audio' file field" }, { status: 400 });
  }
  const buf = Buffer.from(await audio.arrayBuffer());
  if (buf.length === 0 || buf.length % 2 !== 0) {
    return Response.json({ error: "invalid PCM audio" }, { status: 400 });
  }
  if (buf.length > MAX_PCM_BYTES) {
    return Response.json({ error: "payload too large" }, { status: 413 });
  }
  try {
    const transcript = await deps.transcribe(buf);
    log({ audioBytes: buf.length, transcriptLength: transcript.length });
    return Response.json({ transcript });
  } catch (error) {
    // Upstream detail stays in the server log; the browser gets a plain line.
    logError(error instanceof Error ? error.message : String(error));
    return Response.json({ error: "transcription failed" }, { status: 502 });
  }
}

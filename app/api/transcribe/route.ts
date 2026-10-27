import { spawn } from "node:child_process";
import WebSocket from "ws";

// NOTE: no `export const runtime` here — route handlers already run on the
// Node.js runtime by default, and Next 16's Cache Components rejects an
// explicit runtime export on this route.

// Server-only route. The Meta Model API key is read from the server
// environment and never leaves the server: it is never sent to the browser,
// never logged, and never written to a file.
//
// ASR protocol (confirmed against Meta's documented protocol as implemented
// by pipecat's Meta STT service and corroborated by independent write-ups):
// the realtime endpoint IGNORES the Authorization header — the credential
// travels in the first JSON handshake frame, which must arrive within 10
// seconds of connecting. The brief's sketch showed a Bearer header; that
// does not work on this endpoint, so this route uses the handshake frame.
// Audio is raw PCM16 (16 kHz mono). ENDPOINTING mode emits speechStart,
// cumulative transcript partials, speechEnd, and a final speechComplete
// carrying the transcript; speechEnd itself carries no transcript.

function convertToPcm16k(input: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      "pipe:0",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-f",
      "s16le",
      "-acodec",
      "pcm_s16le",
      "pipe:1",
    ]);
    const chunks: Buffer[] = [];
    let stderr = "";
    ffmpeg.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    ffmpeg.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    ffmpeg.on("error", reject);
    ffmpeg.on("close", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(chunks));
      } else {
        reject(new Error(`ffmpeg failed (code ${code}): ${stderr}`));
      }
    });
    ffmpeg.stdin.end(input);
  });
}

function transcribePcm(pcm: Buffer, apiKey: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket("wss://api.meta.ai/v1/asr/realtime");
    let partial = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        try {
          socket.terminate();
        } catch {
          // ignore
        }
        reject(new Error("ASR timed out after 60s"));
      }
    }, 60_000);

    const finish = (transcript: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        // ignore
      }
      resolve(transcript);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.terminate();
      } catch {
        // ignore
      }
      reject(error);
    };

    socket.on("open", () => {
      // First frame: handshake + auth. The header is ignored by this
      // endpoint, so the credential goes here and nowhere else.
      socket.send(
        JSON.stringify({
          authorization: { accessToken: `Bearer ${apiKey}` },
          audioEncoding: "PCM_16KHZ",
          model: "muse-voice-transcribe-1.0",
          mode: "ENDPOINTING",
          partialMode: "CUMULATIVE",
          emitAudioProgress: false,
        }),
      );
    });

    let handshakeDone = false;
    socket.on("message", (data: WebSocket.RawData) => {
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(data.toString()) as Record<string, unknown>;
      } catch {
        return;
      }
      const type = message.type as string | undefined;
      if (!handshakeDone) {
        // The first message is the session acknowledgement — unless it is an
        // error (e.g. rejected credential), which must fail fast instead of
        // being consumed as an ACK while audio goes into a dead session.
        if (type === "error") {
          fail(
            new Error(
              `ASR handshake error: ${(message.message as string | undefined) ?? "unknown"}`,
            ),
          );
          return;
        }
        handshakeDone = true;
        const chunkSize = 3200; // 100 ms of 16 kHz mono 16-bit audio
        for (let i = 0; i < pcm.length; i += chunkSize) {
          socket.send(pcm.subarray(i, i + chunkSize));
        }
        socket.send(JSON.stringify({ type: "endStream" }));
        return;
      }
      if (type === "transcript") {
        const text = message.transcript as string | undefined;
        if (text) partial = text;
      } else if (type === "speechComplete") {
        const text = (message.transcript as string | undefined) ?? partial;
        finish(text);
      } else if (type === "error") {
        fail(
          new Error(
            `ASR error: ${(message.message as string | undefined) ?? "unknown"}`,
          ),
        );
      }
      // speechStart / speechEnd / speaker / audioProgress carry no transcript.
    });

    socket.on("close", () => {
      if (!handshakeDone) {
        // Closed before the session acknowledgement: the handshake failed
        // (bad credential, bad frame) — surface it, do not return "".
        fail(
          new Error(
            "ASR connection closed before session acknowledgement",
          ),
        );
        return;
      }
      // Server closed without speechComplete: fall back to the last partial.
      finish(partial);
    });
    socket.on("error", (error: Error) => fail(error));
  });
}

export async function POST(req: Request) {
  const apiKey = process.env.META_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "META_API_KEY is not configured on the server" },
      { status: 500 },
    );
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
  try {
    const input = Buffer.from(await audio.arrayBuffer());
    const pcm = await convertToPcm16k(input);
    const transcript = await transcribePcm(pcm, apiKey);
    // Evidence for the Day 1 voice check: a real api.meta.ai call happened
    // for this turn. The key is never logged.
    console.log("api.meta.ai asr call", {
      audioBytes: pcm.length,
      transcript,
      transcriptLength: transcript.length,
    });
    return Response.json({ transcript });
  } catch (error) {
    const message = error instanceof Error ? error.message : "transcription failed";
    return Response.json({ error: message }, { status: 502 });
  }
}

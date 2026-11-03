import { handleTranscribe } from "../../../lib/transcribe-handler";
import { createRateLimiter } from "../../../lib/request-guard";
import { buildAsrHandshake } from "../../../lib/meta-models";
import WebSocket from "ws";

// Keep ws on its pure-JS masking path in every runtime (see next.config.ts).
process.env.WS_NO_BUFFER_UTIL = "true";

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
      // endpoint, so the credential goes here and nowhere else. The
      // handshake also carries ASR keyword/language biasing (it cannot
      // change mid-session) — see lib/meta-models.ts.
      socket.send(JSON.stringify(buildAsrHandshake(apiKey)));
    });

    let handshakeDone = false;
    socket.on("message", async (data: WebSocket.RawData) => {
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
        // Pace the buffered audio instead of dumping it as fast as the
        // network allows: the realtime docs reject streams that run
        // far ahead of real time ("Audio processing backlog"). 100 ms
        // of audio every 10 ms is ~10x real time — fast, not a flood.
        const chunkSize = 3200; // 100 ms of 16 kHz mono 16-bit audio
        for (let i = 0; i < pcm.length; i += chunkSize) {
          if (settled) return;
          socket.send(pcm.subarray(i, i + chunkSize));
          if (i + chunkSize < pcm.length) await new Promise((r) => setTimeout(r, 10));
        }
        if (!settled) socket.send(JSON.stringify({ type: "endStream" }));
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

const limiter = createRateLimiter({ limit: 20, windowMs: 60_000 });

export async function POST(req: Request) {
  const apiKey = process.env.META_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "META_API_KEY is not configured on the server" },
      { status: 500 },
    );
  }
  return handleTranscribe(req, {
    limiter,
    transcribe: (pcm) => transcribePcm(pcm, apiKey),
  });
}

import WebSocket from "ws";
import { buildAsrHandshake } from "./meta-models.ts";

export interface TranscribePcmOptions {
  url?: string;
  timeoutMs?: number;
  chunkSize?: number;
  pacerMs?: number;
}

export function transcribePcm(
  pcm: Buffer,
  apiKey: string,
  options: TranscribePcmOptions = {},
): Promise<string> {
  const url = options.url ?? "wss://api.meta.ai/v1/asr/realtime";
  const timeoutMs = options.timeoutMs ?? 15_000;
  const chunkSize = options.chunkSize ?? 3200; // 100 ms of 16 kHz mono 16-bit audio
  const pacerMs = options.pacerMs ?? 10;

  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
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
        reject(new Error(`ASR timed out after ${Math.round(timeoutMs / 1000)}s`));
      }
    }, timeoutMs);

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

    const sendHandshake = () => {
      try {
        socket.send(JSON.stringify(buildAsrHandshake(apiKey)));
      } catch (err) {
        fail(err instanceof Error ? err : new Error(String(err)));
      }
    };

    if (socket.readyState === WebSocket.OPEN) {
      sendHandshake();
    } else {
      socket.on("open", sendHandshake);
    }

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
        if (type === "error") {
          fail(
            new Error(
              `ASR handshake error: ${(message.message as string | undefined) ?? "unknown"}`,
            ),
          );
          return;
        }
        handshakeDone = true;
        for (let i = 0; i < pcm.length; i += chunkSize) {
          if (settled) return;
          socket.send(pcm.subarray(i, i + chunkSize));
          if (i + chunkSize < pcm.length && pacerMs > 0) {
            await new Promise((r) => setTimeout(r, pacerMs));
          }
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
    });

    socket.on("close", () => {
      if (!handshakeDone) {
        fail(
          new Error(
            "ASR connection closed before session acknowledgement",
          ),
        );
        return;
      }
      finish(partial);
    });
    socket.on("error", (error: Error) => fail(error));
  });
}

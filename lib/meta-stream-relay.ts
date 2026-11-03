import WebSocket from "ws";
import { buildAsrHandshake } from "./meta-models.ts";

export interface StreamRelayOptions {
  apiKey?: string;
  metaUrl?: string;
  silenceIntervalMs?: number;
  silenceThresholdMs?: number;
  maxSessionAgeMs?: number;
  log?: (msg: string, extra?: unknown) => void;
}

const DEFAULT_META_URL = "wss://api.meta.ai/v1/asr/realtime";
// 100ms of 16kHz mono 16-bit PCM silence = 1600 samples = 3200 bytes of zeros
const SILENCE_CHUNK = Buffer.alloc(3200, 0);
const DEFAULT_SILENCE_INTERVAL_MS = 500;
const DEFAULT_SILENCE_THRESHOLD_MS = 1200;
// Re-handshake before Meta's 60-minute limit
const DEFAULT_MAX_SESSION_AGE_MS = 50 * 60 * 1000;

export function handleStreamClient(clientWs: WebSocket, options: StreamRelayOptions = {}) {
  const apiKey = options.apiKey ?? process.env.META_API_KEY;
  const metaUrl = options.metaUrl ?? DEFAULT_META_URL;
  const silenceIntervalMs = options.silenceIntervalMs ?? DEFAULT_SILENCE_INTERVAL_MS;
  const silenceThresholdMs = options.silenceThresholdMs ?? DEFAULT_SILENCE_THRESHOLD_MS;
  const maxSessionAgeMs = options.maxSessionAgeMs ?? DEFAULT_MAX_SESSION_AGE_MS;
  const log = options.log ?? ((msg: string, extra?: unknown) => {
    if (process.env.DEBUG_ASR) console.log(`[asr-relay] ${msg}`, extra ?? "");
  });

  if (!apiKey) {
    clientWs.send(JSON.stringify({ type: "error", message: "META_API_KEY is not configured on the server" }));
    clientWs.close(1008, "Missing API key");
    return;
  }

  let metaWs: WebSocket | null = null;
  let lastAudioSentTime = Date.now();
  let silenceTimer: NodeJS.Timeout | null = null;
  let rehandshakeTimer: NodeJS.Timeout | null = null;
  let isClosed = false;
  let handshakeAcknowledged = false;
  const pendingBuffer: Buffer[] = [];

  function sendToMeta(data: Buffer | string) {
    if (metaWs && metaWs.readyState === WebSocket.OPEN) {
      metaWs.send(data);
      if (typeof data !== "string") {
        lastAudioSentTime = Date.now();
      }
    } else if (typeof data !== "string") {
      pendingBuffer.push(data);
    }
  }

  function startSilencePacing() {
    if (silenceTimer) clearInterval(silenceTimer);
    silenceTimer = setInterval(() => {
      if (isClosed || !metaWs || metaWs.readyState !== WebSocket.OPEN) return;
      const now = Date.now();
      // Pad silence during gaps so Meta ASR connection doesn't go quiet or drop
      if (now - lastAudioSentTime >= silenceThresholdMs && handshakeAcknowledged) {
        try {
          metaWs.send(SILENCE_CHUNK);
          lastAudioSentTime = now;
        } catch (err) {
          log("failed to send silence padding", err);
        }
      }
    }, silenceIntervalMs);
  }

  function connectToMeta() {
    if (isClosed) return;
    try {
      if (metaWs) {
        try { metaWs.terminate(); } catch { /* ignore */ }
      }
      handshakeAcknowledged = false;
      lastAudioSentTime = Date.now();
      metaWs = new WebSocket(metaUrl);

      const sendHandshake = () => {
        try {
          metaWs?.send(JSON.stringify(buildAsrHandshake(apiKey as string)));
          log("handshake sent to Meta ASR");
        } catch (err) {
          log("error sending handshake", err);
        }
      };

      if (metaWs.readyState === WebSocket.OPEN) {
        sendHandshake();
      } else {
        metaWs.on("open", sendHandshake);
      }

      metaWs.on("message", (raw: WebSocket.RawData) => {
        if (isClosed) return;
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(raw.toString()) as Record<string, unknown>;
        } catch {
          return;
        }

        const type = msg.type as string | undefined;
        log("meta event", type);

        if (msg.sessionId || type === "sessionAck") {
          handshakeAcknowledged = true;
          // Flush any audio buffered during connection/handshake
          while (pendingBuffer.length > 0) {
            const chunk = pendingBuffer.shift();
            if (chunk && metaWs && metaWs.readyState === WebSocket.OPEN) {
              metaWs.send(chunk);
              lastAudioSentTime = Date.now();
            }
          }
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({ type: "ready", sessionId: msg.sessionId }));
          }
        } else if (type === "speechStart") {
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({
              type: "speechStart",
              turnId: msg.turnId,
              audioProcessedMs: msg.audioProcessedMs,
            }));
          }
        } else if (type === "transcript") {
          // Forward CUMULATIVE partial transcript verbatim
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({
              type: "transcript",
              transcript: msg.transcript,
              final: msg.final,
              audioProcessedMs: msg.audioProcessedMs,
            }));
          }
        } else if (type === "speechEnd") {
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({
              type: "speechEnd",
              turnId: msg.turnId,
              audioProcessedMs: msg.audioProcessedMs,
            }));
          }
        } else if (type === "speechComplete") {
          // Forward authoritative final transcript
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({
              type: "speechComplete",
              transcript: msg.transcript,
              turnId: msg.turnId,
              audioProcessedMs: msg.audioProcessedMs,
            }));
          }
        } else if (type === "error") {
          log("meta error", msg.message);
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({ type: "error", message: msg.message ?? "ASR upstream error" }));
          }
        }
      });

      metaWs.on("close", (code, reason) => {
        log("meta connection closed", { code, reason: reason.toString() });
        if (!isClosed && clientWs.readyState === WebSocket.OPEN) {
          // If unexpectedly closed and client is still connected, notify
          clientWs.send(JSON.stringify({ type: "closed", message: "Meta ASR closed" }));
        }
      });

      metaWs.on("error", (err) => {
        log("meta socket error", err.message);
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(JSON.stringify({ type: "error", message: err.message }));
        }
      });

      // Schedule seamless re-handshake before 60-min session age limit
      if (rehandshakeTimer) clearTimeout(rehandshakeTimer);
      rehandshakeTimer = setTimeout(() => {
        if (!isClosed) {
          log("approaching max session age, refreshing Meta connection");
          connectToMeta();
        }
      }, maxSessionAgeMs);
    } catch (err) {
      log("error initiating Meta socket", err);
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({ type: "error", message: "Failed to connect to Meta ASR" }));
      }
    }
  }

  // Handle incoming data from browser client
  clientWs.on("message", (data: WebSocket.RawData, isBinary: boolean) => {
    if (isClosed) return;
    if (isBinary) {
      // Forward PCM16 binary audio frame verbatim to Meta
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
      sendToMeta(buf);
    } else {
      // Control JSON messages
      try {
        const msg = JSON.parse(data.toString()) as Record<string, unknown>;
        if (msg.type === "endStream") {
          sendToMeta(JSON.stringify({ type: "endStream" }));
        } else if (msg.type === "ping") {
          clientWs.send(JSON.stringify({ type: "pong" }));
        }
      } catch {
        // ignore non-json text
      }
    }
  });

  clientWs.on("close", () => {
    isClosed = true;
    if (silenceTimer) clearInterval(silenceTimer);
    if (rehandshakeTimer) clearTimeout(rehandshakeTimer);
    if (metaWs) {
      try {
        metaWs.terminate();
      } catch {
        // ignore
      }
      metaWs = null;
    }
  });

  clientWs.on("error", () => {
    isClosed = true;
    if (silenceTimer) clearInterval(silenceTimer);
    if (rehandshakeTimer) clearTimeout(rehandshakeTimer);
    if (metaWs) {
      try { metaWs.terminate(); } catch { /* ignore */ }
      metaWs = null;
    }
  });

  connectToMeta();
  startSilencePacing();
}

import WebSocket from "ws";
import { buildGeminiLiveSetup } from "./gemini-models.ts";
import { VVB_SYSTEM_PROMPT } from "./agent-prompt.ts";

export interface GeminiStreamRelayOptions {
  apiKey?: string;
  geminiUrl?: string;
  systemPrompt?: string;
  log?: (msg: string, extra?: unknown) => void;
}

const DEFAULT_GEMINI_LIVE_URL =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";

export function handleStreamClient(
  clientWs: WebSocket,
  options: GeminiStreamRelayOptions = {},
) {
  const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY;
  const baseUrl = options.geminiUrl ?? DEFAULT_GEMINI_LIVE_URL;
  const systemPrompt = options.systemPrompt ?? VVB_SYSTEM_PROMPT;
  const log =
    options.log ??
    ((msg: string, extra?: unknown) => {
      if (process.env.DEBUG_ASR) console.log(`[gemini-live-relay] ${msg}`, extra ?? "");
    });

  if (!apiKey) {
    clientWs.send(
      JSON.stringify({
        type: "error",
        message: "GEMINI_API_KEY is not configured on the server",
      }),
    );
    clientWs.close(1008, "Missing API key");
    return;
  }

  let geminiWs: WebSocket | null = null;
  let isClosed = false;
  let setupAcknowledged = false;
  const pendingAudioChunks: Buffer[] = [];

  const targetUrl = baseUrl.includes("?")
    ? `${baseUrl}&key=${apiKey}`
    : `${baseUrl}?key=${apiKey}`;

  function connectToGemini() {
    if (isClosed) return;
    try {
      if (geminiWs) {
        try {
          geminiWs.terminate();
        } catch {
          // ignore
        }
      }
      setupAcknowledged = false;
      geminiWs = new WebSocket(targetUrl);

      geminiWs.on("open", () => {
        try {
          const setupPayload = buildGeminiLiveSetup(systemPrompt);
          geminiWs?.send(JSON.stringify(setupPayload));
          log("Setup message sent to Gemini Live API");
        } catch (err) {
          log("Error sending setup to Gemini Live", err);
        }
      });

      geminiWs.on("message", (raw: WebSocket.RawData) => {
        if (isClosed) return;
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(raw.toString()) as Record<string, unknown>;
        } catch {
          return;
        }

        // 1. Initial setup confirmation
        if (msg.setupComplete) {
          setupAcknowledged = true;
          log("Gemini Live session ready");
          clientWs.send(JSON.stringify({ type: "ready" }));

          // Flush any buffered audio chunks
          while (pendingAudioChunks.length > 0) {
            const chunk = pendingAudioChunks.shift();
            if (chunk) sendAudioToGemini(chunk);
          }
          return;
        }

        // 2. Tool calls from Gemini
        if (msg.toolCall && typeof msg.toolCall === "object") {
          const tc = msg.toolCall as { functionCalls?: Array<{ id: string; name: string; args: unknown }> };
          const calls = tc.functionCalls ?? [];
          for (const call of calls) {
            log(`Gemini toolCall: ${call.name}`, call.args);
            clientWs.send(
              JSON.stringify({
                type: "toolCall",
                id: call.id,
                name: call.name,
                args: call.args,
              }),
            );
          }
          return;
        }

        // 3. Audio & transcript responses from model turn
        if (msg.serverContent && typeof msg.serverContent === "object") {
          const sc = msg.serverContent as {
            interrupted?: boolean;
            modelTurn?: {
              parts?: Array<{
                text?: string;
                inlineData?: { mimeType: string; data: string };
              }>;
            };
            turnComplete?: boolean;
          };

          if (sc.interrupted) {
            log("Gemini Live turn interrupted");
            clientWs.send(JSON.stringify({ type: "interrupted" }));
          }

          if (sc.modelTurn?.parts) {
            for (const part of sc.modelTurn.parts) {
              if (part.inlineData) {
                // Audio chunk (24kHz PCM base64)
                clientWs.send(
                  JSON.stringify({
                    type: "audio",
                    data: part.inlineData.data,
                    mimeType: part.inlineData.mimeType,
                  }),
                );
              }
              if (part.text) {
                clientWs.send(
                  JSON.stringify({
                    type: "transcript",
                    transcript: part.text,
                  }),
                );
              }
            }
          }

          if (sc.turnComplete) {
            log("Gemini Live server turn complete");
            clientWs.send(JSON.stringify({ type: "speechComplete" }));
          }
        }
      });

      geminiWs.on("error", (err) => {
        log("Gemini Live upstream error", err);
        if (!isClosed && clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(
            JSON.stringify({
              type: "error",
              message: `Gemini Live upstream error: ${err.message}`,
            }),
          );
        }
      });

      geminiWs.on("close", (code, reason) => {
        log(`Gemini Live upstream closed: ${code}`, reason.toString());
        if (!isClosed && clientWs.readyState === WebSocket.OPEN) {
          clientWs.close(code, reason);
        }
      });
    } catch (err) {
      log("Failed to connect to Gemini Live", err);
    }
  }

  function sendAudioToGemini(buffer: Buffer) {
    if (geminiWs && geminiWs.readyState === WebSocket.OPEN && setupAcknowledged) {
      geminiWs.send(
        JSON.stringify({
          realtimeInput: {
            mediaChunks: [
              {
                mimeType: "audio/pcm;rate=16000",
                data: buffer.toString("base64"),
              },
            ],
          },
        }),
      );
    } else {
      pendingAudioChunks.push(buffer);
    }
  }

  clientWs.on("message", (data: WebSocket.RawData, isBinary: boolean) => {
    if (isClosed) return;

    if (isBinary) {
      const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
      sendAudioToGemini(buffer);
      return;
    }

    try {
      const text = data.toString();
      const msg = JSON.parse(text) as Record<string, unknown>;

      if (msg.type === "toolResponse" && typeof msg.id === "string") {
        // Send tool response back to Gemini so it can continue speaking
        if (geminiWs && geminiWs.readyState === WebSocket.OPEN) {
          geminiWs.send(
            JSON.stringify({
              toolResponse: {
                functionResponses: [
                  {
                    id: msg.id,
                    response: { output: msg.output ?? { success: true } },
                  },
                ],
              },
            }),
          );
        }
      } else if (msg.type === "userText" && typeof msg.text === "string") {
        if (geminiWs && geminiWs.readyState === WebSocket.OPEN) {
          geminiWs.send(
            JSON.stringify({
              clientContent: {
                turns: [
                  {
                    role: "user",
                    parts: [{ text: msg.text }],
                  },
                ],
                turnComplete: true,
              },
            }),
          );
        }
      }
    } catch {
      // ignore malformed client message
    }
  });

  clientWs.on("close", () => {
    isClosed = true;
    if (geminiWs) {
      try {
        geminiWs.close();
      } catch {
        // ignore
      }
    }
  });

  clientWs.on("error", (err) => {
    log("Client socket error", err);
    isClosed = true;
    if (geminiWs) {
      try {
        geminiWs.terminate();
      } catch {
        // ignore
      }
    }
  });

  connectToGemini();
}


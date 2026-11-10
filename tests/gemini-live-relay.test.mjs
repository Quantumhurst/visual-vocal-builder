import { test } from "node:test";
import assert from "node:assert/strict";
import { WebSocketServer, WebSocket } from "ws";
import { handleStreamClient } from "../lib/gemini-live-relay.ts";
import { LIVE_MODEL, BRAIN_MODEL, GEMINI_FUNCTION_DECLARATIONS } from "../lib/gemini-models.ts";

test("gemini-models: exports valid configuration and 12 function declarations", () => {
  assert.equal(BRAIN_MODEL, "gemini-2.5-flash");
  assert.equal(LIVE_MODEL, "models/gemini-3.8-live");
  assert.equal(GEMINI_FUNCTION_DECLARATIONS.length, 12);
  const toolNames = GEMINI_FUNCTION_DECLARATIONS.map((t) => t.name);
  assert.ok(toolNames.includes("showJurisdictionComparison"));
  assert.ok(toolNames.includes("setFounderEquity"));
  assert.ok(toolNames.includes("prepareLawyerSummary"));
});

test("gemini-live-relay: rejects client when API key is missing", async () => {
  const server = new WebSocketServer({ port: 0 });
  await new Promise((resolve) => server.on("listening", resolve));
  const port = server.address().port;

  server.on("connection", (clientWs) => {
    handleStreamClient(clientWs, { apiKey: "" });
  });

  const client = new WebSocket(`ws://localhost:${port}`);
  const messages = [];
  client.on("message", (data) => messages.push(JSON.parse(data.toString())));

  await new Promise((resolve) => client.on("close", resolve));
  assert.equal(messages.length, 1);
  assert.match(messages[0].message, /GEMINI_API_KEY is not configured/);

  await new Promise((resolve) => server.close(resolve));
});

test("gemini-live-relay: connects, sends setup, streams audio, relays tool calls and audio", async () => {
  // 1. Mock upstream Gemini Live server
  const mockGeminiServer = new WebSocketServer({ port: 0 });
  await new Promise((resolve) => mockGeminiServer.on("listening", resolve));
  const geminiPort = mockGeminiServer.address().port;
  const geminiUrl = `ws://localhost:${geminiPort}`;

  let receivedSetup = null;
  let receivedAudioChunks = 0;
  let receivedToolResponse = null;

  mockGeminiServer.on("connection", (geminiSocket) => {
    geminiSocket.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.setup) {
        receivedSetup = msg.setup;
        geminiSocket.send(JSON.stringify({ setupComplete: {} }));
      } else if (msg.realtimeInput) {
        receivedAudioChunks += msg.realtimeInput.mediaChunks?.length ?? 0;
        // Simulate Gemini returning a tool call
        geminiSocket.send(
          JSON.stringify({
            toolCall: {
              functionCalls: [
                {
                  id: "call-1",
                  name: "showJurisdictionComparison",
                  args: { jurisdiction: "Mars" },
                },
              ],
            },
          }),
        );
      } else if (msg.toolResponse) {
        receivedToolResponse = msg.toolResponse;
        // Simulate Gemini speaking audio back
        geminiSocket.send(
          JSON.stringify({
            serverContent: {
              modelTurn: {
                parts: [
                  {
                    inlineData: {
                      mimeType: "audio/pcm;rate=24000",
                      data: Buffer.from([1, 2, 3, 4]).toString("base64"),
                    },
                  },
                ],
              },
              turnComplete: true,
            },
          }),
        );
      }
    });
  });

  // 2. App relay server
  const relayServer = new WebSocketServer({ port: 0 });
  await new Promise((resolve) => relayServer.on("listening", resolve));
  const relayPort = relayServer.address().port;

  relayServer.on("connection", (clientWs) => {
    handleStreamClient(clientWs, {
      apiKey: "test-gemini-key",
      geminiUrl,
    });
  });

  // 3. Connect client
  const client = new WebSocket(`ws://localhost:${relayPort}`);
  const clientMessages = [];
  client.on("message", (data) => {
    const parsed = JSON.parse(data.toString());
    clientMessages.push(parsed);

    if (parsed.type === "toolCall") {
      client.send(
        JSON.stringify({
          type: "toolResponse",
          id: parsed.id,
          output: { success: true },
        }),
      );
    }
  });

  await new Promise((resolve) => client.on("open", resolve));

  // Wait for ready
  while (!clientMessages.some((m) => m.type === "ready")) {
    await new Promise((r) => setTimeout(r, 20));
  }

  // Stream PCM audio
  const pcm = Buffer.alloc(1600, 1);
  client.send(pcm);

  // Wait for speechComplete
  while (!clientMessages.some((m) => m.type === "speechComplete")) {
    await new Promise((r) => setTimeout(r, 20));
  }

  assert.equal(receivedSetup.model, LIVE_MODEL);
  assert.ok(receivedAudioChunks >= 1, "Audio received upstream");
  assert.equal(receivedToolResponse?.functionResponses?.[0]?.id, "call-1");

  const audioMsg = clientMessages.find((m) => m.type === "audio");
  assert.ok(audioMsg, "Client received audio message");
  assert.equal(audioMsg.mimeType, "audio/pcm;rate=24000");

  client.close();
  await new Promise((resolve) => relayServer.close(resolve));
  await new Promise((resolve) => mockGeminiServer.close(resolve));
});


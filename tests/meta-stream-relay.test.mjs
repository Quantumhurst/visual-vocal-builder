import { test } from "node:test";
import assert from "node:assert/strict";
import { WebSocketServer, WebSocket } from "ws";
import { handleStreamClient } from "../lib/meta-stream-relay.ts";

test("meta-stream-relay: rejects client when API key is missing", async () => {
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
  assert.match(messages[0].message, /META_API_KEY is not configured/);

  await new Promise((resolve) => server.close(resolve));
});

test("meta-stream-relay: connects, handshakes, streams PCM, and relays partials & speechComplete", async () => {
  // 1. Mock Meta ASR server
  const metaServer = new WebSocketServer({ port: 0 });
  await new Promise((resolve) => metaServer.on("listening", resolve));
  const metaPort = metaServer.address().port;
  const metaUrl = `ws://localhost:${metaPort}`;

  let metaReceivedHandshake = null;
  let metaReceivedChunks = 0;

  metaServer.on("connection", (metaSocket) => {
    metaSocket.on("message", (data, isBinary) => {
      if (isBinary) {
        metaReceivedChunks++;
        return;
      }
      const msg = JSON.parse(data.toString());
      if (msg.model && msg.authorization) {
        metaReceivedHandshake = msg;
        metaSocket.send(JSON.stringify({ type: "sessionAck", sessionId: "sess-123" }));
      }
    });
  });

  // 2. Mock app relay server
  const relayServer = new WebSocketServer({ port: 0 });
  await new Promise((resolve) => relayServer.on("listening", resolve));
  const relayPort = relayServer.address().port;

  relayServer.on("connection", (clientWs) => {
    handleStreamClient(clientWs, {
      apiKey: "test-meta-key",
      metaUrl,
      silenceIntervalMs: 50,
      silenceThresholdMs: 100,
    });
  });

  // 3. Client connection
  const client = new WebSocket(`ws://localhost:${relayPort}`);
  const clientMessages = [];
  client.on("message", (data) => {
    clientMessages.push(JSON.parse(data.toString()));
  });

  await new Promise((resolve) => client.on("open", resolve));

  // Wait for ready
  await new Promise((resolve) => {
    const check = () => {
      if (clientMessages.some((m) => m.type === "ready")) resolve();
      else setTimeout(check, 10);
    };
    check();
  });

  assert.equal(metaReceivedHandshake?.model, "muse-voice-transcribe-1.0");
  assert.equal(metaReceivedHandshake?.mode, "ENDPOINTING");
  assert.equal(metaReceivedHandshake?.partialMode, "CUMULATIVE");

  // Send binary PCM frame
  const pcmFrame = Buffer.alloc(3200, 42);
  client.send(pcmFrame);

  await new Promise((r) => setTimeout(r, 50));
  assert.ok(metaReceivedChunks >= 1, "Meta received audio frame");

  // Simulate Meta sending partial transcript
  const [metaSocket] = Array.from(metaServer.clients);
  assert.ok(metaSocket, "Meta socket connected");
  metaSocket.send(JSON.stringify({ type: "transcript", transcript: "pick eur" }));

  // Simulate Meta sending speechComplete
  metaSocket.send(JSON.stringify({ type: "speechComplete", transcript: "pick Europa" }));

  await new Promise((resolve) => {
    const check = () => {
      if (clientMessages.some((m) => m.type === "speechComplete")) resolve();
      else setTimeout(check, 10);
    };
    check();
  });

  const partial = clientMessages.find((m) => m.type === "transcript");
  const complete = clientMessages.find((m) => m.type === "speechComplete");
  assert.equal(partial?.transcript, "pick eur");
  assert.equal(complete?.transcript, "pick Europa");

  // Clean up
  client.close();
  await new Promise((r) => setTimeout(r, 30));
  await new Promise((resolve) => relayServer.close(resolve));
  await new Promise((resolve) => metaServer.close(resolve));
});

test("meta-stream-relay: sends silence padding during audio gaps", async () => {
  const metaServer = new WebSocketServer({ port: 0 });
  await new Promise((resolve) => metaServer.on("listening", resolve));
  const metaPort = metaServer.address().port;
  const metaUrl = `ws://localhost:${metaPort}`;

  let binaryChunksReceived = 0;
  metaServer.on("connection", (metaSocket) => {
    metaSocket.on("message", (data, isBinary) => {
      if (isBinary) {
        binaryChunksReceived++;
        return;
      }
      const msg = JSON.parse(data.toString());
      if (msg.model) {
        metaSocket.send(JSON.stringify({ type: "sessionAck", sessionId: "sess-silence" }));
      }
    });
  });

  const relayServer = new WebSocketServer({ port: 0 });
  await new Promise((resolve) => relayServer.on("listening", resolve));
  const relayPort = relayServer.address().port;

  relayServer.on("connection", (clientWs) => {
    handleStreamClient(clientWs, {
      apiKey: "test-meta-key",
      metaUrl,
      silenceIntervalMs: 25,
      silenceThresholdMs: 50,
    });
  });

  const client = new WebSocket(`ws://localhost:${relayPort}`);
  await new Promise((resolve) => client.on("open", resolve));

  // Wait 150ms with no client audio to ensure silence padding kicks in
  await new Promise((r) => setTimeout(r, 150));

  assert.ok(binaryChunksReceived >= 1, `Expected silence padding chunks, got ${binaryChunksReceived}`);

  client.close();
  await new Promise((resolve) => relayServer.close(resolve));
  await new Promise((resolve) => metaServer.close(resolve));
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { WebSocketServer } from "ws";
import { transcribePcm } from "../lib/meta-asr.ts";

test("meta-asr: successful handshake, chunk transmission, and speechComplete", async () => {
  const wss = new WebSocketServer({ port: 0 });
  await new Promise((resolve) => wss.on("listening", resolve));
  const port = wss.address().port;
  const url = `ws://localhost:${port}`;

  let receivedHandshake = null;
  let receivedChunks = 0;
  let receivedEndStream = false;

  wss.on("connection", (ws) => {
    ws.on("message", (data, isBinary) => {
      if (isBinary) {
        receivedChunks++;
        return;
      }
      const msg = JSON.parse(data.toString());
      if (msg.model && msg.authorization) {
        receivedHandshake = msg;
        ws.send(JSON.stringify({ type: "sessionAck" }));
        return;
      }
      if (msg.type === "endStream") {
        receivedEndStream = true;
        ws.send(JSON.stringify({ type: "transcript", transcript: "pick mars" }));
        ws.send(JSON.stringify({ type: "speechComplete", transcript: "pick mars" }));
      }
    });
  });

  const pcm = Buffer.alloc(6400, 1);
  const transcript = await transcribePcm(pcm, "test-api-key", { url, pacerMs: 1 });

  assert.equal(transcript, "pick mars");
  assert.equal(receivedHandshake?.model, "muse-voice-transcribe-1.0");
  assert.equal(receivedHandshake?.authorization?.accessToken, "Bearer test-api-key");
  assert.equal(receivedChunks, 2);
  assert.equal(receivedEndStream, true);

  await new Promise((resolve) => wss.close(resolve));
});

test("meta-asr: handshake rejection fails fast with error", async () => {
  const wss = new WebSocketServer({ port: 0 });
  await new Promise((resolve) => wss.on("listening", resolve));
  const port = wss.address().port;
  const url = `ws://localhost:${port}`;

  wss.on("connection", (ws) => {
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.model) {
        ws.send(JSON.stringify({ type: "error", message: "unauthorized" }));
      }
    });
  });

  const pcm = Buffer.alloc(3200);
  await assert.rejects(
    async () => {
      await transcribePcm(pcm, "bad-key", { url, pacerMs: 1 });
    },
    { message: /ASR handshake error: unauthorized/ },
  );

  await new Promise((resolve) => wss.close(resolve));
});

test("meta-asr: socket timeout triggers clean rejection", async () => {
  const wss = new WebSocketServer({ port: 0 });
  await new Promise((resolve) => wss.on("listening", resolve));
  const port = wss.address().port;
  const url = `ws://localhost:${port}`;

  wss.on("connection", (ws) => {
    ws.on("message", (data, isBinary) => {
      if (isBinary) return;
      try {
        const msg = JSON.parse(data.toString());
        if (msg.model) {
          ws.send(JSON.stringify({ type: "sessionAck" }));
        }
      } catch {
        // ignore
      }
    });
  });

  const pcm = Buffer.alloc(3200);
  await assert.rejects(
    async () => {
      await transcribePcm(pcm, "key", { url, timeoutMs: 100, pacerMs: 1 });
    },
    { message: /ASR timed out/ },
  );

  await new Promise((resolve) => wss.close(resolve));
});

test("meta-asr: connection closed before handshake acknowledgment", async () => {
  const wss = new WebSocketServer({ port: 0 });
  await new Promise((resolve) => wss.on("listening", resolve));
  const port = wss.address().port;
  const url = `ws://localhost:${port}`;

  wss.on("connection", (ws) => {
    ws.close();
  });

  const pcm = Buffer.alloc(3200);
  await assert.rejects(
    async () => {
      await transcribePcm(pcm, "key", { url, pacerMs: 1 });
    },
    { message: /ASR connection closed before session acknowledgement/ },
  );

  await new Promise((resolve) => wss.close(resolve));
});

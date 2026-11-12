import { test } from "node:test";
import assert from "node:assert/strict";
import { WebSocketServer, WebSocket } from "ws";
import { clearExpectedTranscript, expectTranscript } from "../lib/fake-provider.ts";
import { createFakeEndpointer, handleFakeStreamClient } from "../lib/fake-stream-relay.ts";
import { isOfflineProvider, providerInfo, resolveProvider } from "../lib/provider.ts";

// 100 ms frames of 16 kHz PCM16.
const frame = (loud) => {
  const pcm = Buffer.alloc(3200);
  if (loud) for (let i = 0; i < 1600; i++) pcm.writeInt16LE(Math.round(Math.sin(i / 6) * 6000), i * 2);
  return pcm;
};
const speak = (ep, speechFrames, silenceFrames) => {
  for (let i = 0; i < speechFrames; i++) ep.audio(frame(true));
  for (let i = 0; i < silenceFrames; i++) ep.audio(frame(false));
};

test("fake-meta: chosen only explicitly; the browser runs the Meta streaming path", () => {
  assert.deepEqual(resolveProvider({ VOICE_PROVIDER: "fake-meta" }), { ok: true, provider: "fake-meta", apiKey: "", source: "explicit" });
  assert.equal(isOfflineProvider("fake-meta"), true);
  assert.equal(isOfflineProvider("meta"), false);
  assert.deepEqual(providerInfo("fake-meta"), {
    provider: "meta",
    streamingAsr: true,
    neuralVoice: false,
    label: "Offline test (Meta streaming)",
    offline: true,
  });
  assert.equal(providerInfo("meta").offline, false);
});

test("fake endpointer: one utterance gives start, a partial, end and the final words", () => {
  clearExpectedTranscript();
  expectTranscript("Pick Mars");
  const events = [];
  const ep = createFakeEndpointer((e) => events.push(e));
  speak(ep, 8, 8);
  assert.deepEqual(events.map((e) => e.type), ["speechStart", "transcript", "speechEnd", "speechComplete"]);
  assert.equal(events[0].turnId, 1);
  assert.equal(events[1].transcript, "Pick Mars");
  assert.equal(events[1].final, false);
  assert.equal("turnId" in events[1], false, "like the real relay, partials carry no turnId");
  assert.equal(events[3].transcript, "Pick Mars");
  assert.equal(events[3].turnId, 1);
});

test("fake endpointer: a short pause inside an utterance does not end it", () => {
  clearExpectedTranscript();
  expectTranscript("Make Nova 40 percent");
  const events = [];
  const ep = createFakeEndpointer((e) => events.push(e));
  speak(ep, 4, 4); // 400 ms gap < 700 ms
  speak(ep, 4, 8);
  assert.equal(events.filter((e) => e.type === "speechStart").length, 1);
  assert.equal(events.filter((e) => e.type === "speechComplete").length, 1);
});

test("fake endpointer: silence alone emits nothing; each utterance gets its own turn and words", () => {
  clearExpectedTranscript();
  const events = [];
  const ep = createFakeEndpointer((e) => events.push(e));
  speak(ep, 0, 30);
  assert.equal(events.length, 0);
  expectTranscript("The planet I want is");
  speak(ep, 6, 8);
  expectTranscript("Mars as our home base");
  speak(ep, 6, 8);
  const finals = events.filter((e) => e.type === "speechComplete");
  assert.deepEqual(finals.map((e) => [e.turnId, e.transcript]), [[1, "The planet I want is"], [2, "Mars as our home base"]]);
});

test("fake relay socket: ready on connect, pong on ping, events for streamed audio", async () => {
  clearExpectedTranscript();
  const server = new WebSocketServer({ port: 0 });
  await new Promise((r) => server.on("listening", r));
  server.on("connection", (ws) => handleFakeStreamClient(ws));
  const client = new WebSocket(`ws://localhost:${server.address().port}`);
  const got = [];
  client.on("message", (d) => got.push(JSON.parse(d.toString())));
  await new Promise((r) => client.on("open", r));
  const waitFor = (type) =>
    new Promise((resolve, reject) => {
      const t0 = Date.now();
      const tick = () => {
        const hit = got.find((m) => m.type === type);
        if (hit) return resolve(hit);
        if (Date.now() - t0 > 2000) return reject(new Error(`no ${type}`));
        setTimeout(tick, 5);
      };
      tick();
    });
  assert.equal((await waitFor("ready")).type, "ready");
  client.send(JSON.stringify({ type: "ping" }));
  await waitFor("pong");
  expectTranscript("Yes, confirm the split");
  for (let i = 0; i < 6; i++) client.send(frame(true));
  for (let i = 0; i < 8; i++) client.send(frame(false));
  const complete = await waitFor("speechComplete");
  assert.equal(complete.transcript, "Yes, confirm the split");
  client.close();
  await new Promise((r) => server.close(r));
});

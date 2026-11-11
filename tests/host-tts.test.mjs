import test from "node:test";
import assert from "node:assert/strict";
import { createHostTts, pcm16Base64ToFloat32, withDeadline } from "../lib/host-tts.ts";

function fakeFetch(handler) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(JSON.parse(init.body));
    return handler(calls.length);
  };
  return { calls, fetchImpl };
}
const okAudio = (audio = "QUJD") => ({ ok: true, status: 200, json: async () => ({ audio }) });

test("host tts: a prefetched line is spoken from cache with no second request", async () => {
  const { calls, fetchImpl } = fakeFetch(() => okAudio());
  const tts = createHostTts({ fetchImpl });
  tts.prefetch("Pick a home base.");
  assert.equal(await tts.get("Pick a home base."), "QUJD");
  assert.equal(await tts.get("  Pick a home base. "), "QUJD");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { text: "Pick a home base.", voice: "Aoede" });
  assert.equal(tts.has("Pick a home base."), true);
});

test("host tts: a failed line is retried next time, not cached", async () => {
  const { calls, fetchImpl } = fakeFetch((n) => (n === 1 ? { ok: false, status: 502, json: async () => ({}) } : okAudio()));
  const tts = createHostTts({ fetchImpl });
  await assert.rejects(tts.get("Hello"));
  assert.equal(tts.unavailable(), false);
  assert.equal(await tts.get("Hello"), "QUJD");
  assert.equal(calls.length, 2);
});

test("host tts: once the server has no neural voice, it stops asking", async () => {
  const { calls, fetchImpl } = fakeFetch(() => ({ ok: false, status: 501, json: async () => ({}) }));
  const tts = createHostTts({ fetchImpl });
  await assert.rejects(tts.get("Hello"));
  assert.equal(tts.unavailable(), true);
  await assert.rejects(tts.get("Another line"));
  tts.prefetch("A third line");
  assert.equal(calls.length, 1);
});

test("host tts: the cache is bounded and drops the oldest line", async () => {
  const { fetchImpl } = fakeFetch((n) => okAudio(`A${n}`));
  const tts = createHostTts({ fetchImpl, maxEntries: 2 });
  await tts.get("one");
  await tts.get("two");
  await tts.get("three");
  assert.equal(tts.has("one"), false);
  assert.equal(tts.has("two"), true);
  assert.equal(tts.has("three"), true);
});

test("withDeadline: a slow line rejects on time; a fast one resolves", async () => {
  await assert.rejects(withDeadline(new Promise((r) => setTimeout(() => r("late"), 60)), 10), /deadline/);
  assert.equal(await withDeadline(Promise.resolve("now"), 50), "now");
  await assert.rejects(withDeadline(Promise.reject(new Error("boom")), 50), /boom/);
});

test("pcm16Base64ToFloat32: decodes little-endian signed samples", () => {
  const pcm = new Int16Array([0, 16384, -16384, 32767, -32768]);
  const base64 = Buffer.from(pcm.buffer).toString("base64");
  const out = pcm16Base64ToFloat32(base64);
  assert.deepEqual(Array.from(out), [0, 0.5, -0.5, 32767 / 32768, -1]);
  assert.equal(pcm16Base64ToFloat32("").length, 0);
});

// Microphone plumbing tests — lib/mic.ts. These cover the transient
// worklet-load failure that used to leave the conversation "live" but
// unable to record, plus the user-facing failure copy.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PCM_WORKLET_URL,
  WORKLET_RETRY_MS,
  loadPcmWorklet,
  micFailureNotice,
} from "../lib/mic.ts";

test("worklet loads on the first attempt without a retry", async () => {
  const calls = [];
  const result = await loadPcmWorklet(async (url) => {
    calls.push(url);
  });
  assert.deepEqual(result, { attempts: 1 });
  assert.deepEqual(calls, [PCM_WORKLET_URL]);
});

test("a transient failure retries once with a cache-busting URL", async () => {
  let calls = 0;
  const urls = [];
  const waits = [];
  const result = await loadPcmWorklet(
    async (url) => {
      calls += 1;
      urls.push(url);
      if (calls === 1) throw new Error("Failed to load worklet module script (Network error)");
    },
    { wait: async (ms) => waits.push(ms) },
  );
  assert.deepEqual(result, { attempts: 2 });
  assert.equal(calls, 2);
  assert.deepEqual(urls, [PCM_WORKLET_URL, `${PCM_WORKLET_URL}?retry=1`]);
  assert.deepEqual(waits, [WORKLET_RETRY_MS]);
});

test("two failures rethrow the first error, not the retry", async () => {
  let calls = 0;
  const first = new Error("first network error");
  await assert.rejects(
    loadPcmWorklet(
      async () => {
        calls += 1;
        throw calls === 1 ? first : new Error("second error");
      },
      { wait: async () => {} },
    ),
    (error) => error === first,
  );
  assert.equal(calls, 2);
});

test("custom URL and delay are honored", async () => {
  const calls = [];
  const waits = [];
  await loadPcmWorklet(
    async (url) => {
      calls.push(url);
      if (calls.length === 1) throw new Error("nope");
    },
    { url: "/other-worklet.js", retryDelayMs: 12, wait: async (ms) => waits.push(ms) },
  );
  assert.deepEqual(calls, ["/other-worklet.js", "/other-worklet.js?retry=1"]);
  assert.deepEqual(waits, [12]);
});

test("permission failure gets permission copy", () => {
  const denied = new Error("Permission denied");
  denied.name = "NotAllowedError";
  assert.match(micFailureNotice(denied), /access was not granted/i);
  assert.match(micFailureNotice("Permission denied"), /access was not granted/i);
});

test("worklet/network failure gets reload-and-retry copy", () => {
  const notice = micFailureNotice(
    new Error("Failed to load worklet module script: /pcm-capture-worklet.js (Network error)"),
  );
  assert.match(notice, /audio engine could not load/i);
  assert.match(notice, /refresh/i);
  assert.doesNotMatch(notice, /access was not granted/i);
});

test("generic failure keeps the detail and offers typing", () => {
  const notice = micFailureNotice(new Error("no audio context"));
  assert.match(notice, /no audio context/);
  assert.match(notice, /type a command/i);
});

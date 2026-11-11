import test from "node:test";
import assert from "node:assert/strict";
import { isBufferSilent, pcmToWav, transcribePcm } from "../lib/gemini-asr.ts";

function tone(samples = 1600) {
  const pcm = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) pcm.writeInt16LE(Math.round(Math.sin(i / 5) * 12000), i * 2);
  return pcm;
}

async function withFetch(impl, run) {
  const real = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await run();
  } finally {
    globalThis.fetch = real;
  }
}

test("gemini asr: silence is never sent upstream", async () => {
  let called = false;
  const text = await withFetch(async () => { called = true; }, () => transcribePcm(Buffer.alloc(3200), "KEY"));
  assert.equal(text, "");
  assert.equal(called, false);
  assert.equal(isBufferSilent(tone()), false);
});

test("gemini asr: the key goes in a header, never in the URL, and thinking is off", async () => {
  let seen;
  const text = await withFetch(
    async (url, init) => {
      seen = { url: String(url), init };
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: ' "Europa" ' }] } }] }) };
    },
    () => transcribePcm(tone(), "SECRET_KEY"),
  );
  assert.equal(text, "Europa");
  assert.equal(seen.url.includes("SECRET_KEY"), false);
  assert.equal(seen.init.headers["x-goog-api-key"], "SECRET_KEY");
  const body = JSON.parse(seen.init.body);
  assert.equal(body.generationConfig.thinkingConfig.thinkingBudget, 0);
  assert.match(body.contents[0].parts[0].text, /Galactic Bagels/);
});

test("gemini asr: an upstream error carries the status but not the response body", async () => {
  await assert.rejects(
    withFetch(
      async () => ({ ok: false, status: 403, text: async () => "body naming SECRET_KEY" }),
      () => transcribePcm(tone(), "SECRET_KEY"),
    ),
    (err) => /403/.test(err.message) && !err.message.includes("SECRET_KEY"),
  );
});

test("pcmToWav: writes a 44-byte mono 16 kHz header", () => {
  const wav = pcmToWav(Buffer.alloc(320));
  assert.equal(wav.length, 364);
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.readUInt32LE(24), 16000);
});

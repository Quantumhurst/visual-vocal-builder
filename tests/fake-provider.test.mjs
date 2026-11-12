import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FAKE_AGENT_REPLY,
  clearExpectedTranscript,
  createFakeBrain,
  expectTranscript,
  fakeTranscribePcm,
} from "../lib/fake-provider.ts";
import { providerInfo, resolveProvider } from "../lib/provider.ts";
import { parseProviderInfo } from "../lib/provider-client.ts";

const speech = () => {
  const pcm = Buffer.alloc(32000);
  for (let i = 0; i < pcm.length / 2; i++) pcm.writeInt16LE(Math.round(Math.sin(i / 8) * 8000), i * 2);
  return pcm;
};
const silence = () => Buffer.alloc(32000);

test("fake mode is chosen only explicitly, needs no key, and never auto-selects", () => {
  const fake = resolveProvider({ VOICE_PROVIDER: "fake" });
  assert.deepEqual(fake, { ok: true, provider: "fake", apiKey: "", source: "explicit" });
  assert.equal(resolveProvider({ GEMINI_API_KEY: "k" }).provider, "gemini");
  assert.equal(resolveProvider({}).ok, false);
});

test("fake mode uses buffered transcription and the browser voice", () => {
  assert.deepEqual(providerInfo("fake"), { provider: "fake", streamingAsr: false, neuralVoice: false, label: "Offline test" });
  assert.equal(parseProviderInfo(providerInfo("fake"))?.provider, "fake");
});

test("fake transcription returns the expected line once, and nothing for silence", async () => {
  clearExpectedTranscript();
  expectTranscript("Pick Mars");
  assert.equal(await fakeTranscribePcm(silence()), "", "silence never consumes the line");
  assert.equal(await fakeTranscribePcm(speech()), "Pick Mars");
  assert.equal(await fakeTranscribePcm(speech()), "", "a line is used once");
});

test("the latest expected line wins, so a skipped transcription cannot shift later turns", async () => {
  clearExpectedTranscript();
  expectTranscript("The planet I want is");
  expectTranscript("Mars as our home base");
  assert.equal(await fakeTranscribePcm(speech()), "Mars as our home base");
});

test("the fake brain streams one fixed reply and finishes", async () => {
  const brain = createFakeBrain();
  assert.equal(brain.specificationVersion, "v3");
  const { stream } = await brain.doStream();
  const parts = [];
  for await (const part of stream) parts.push(part);
  assert.deepEqual(parts.map((p) => p.type), ["stream-start", "text-start", "text-delta", "text-end", "finish"]);
  assert.equal(parts[2].delta, FAKE_AGENT_REPLY);
  const generated = await brain.doGenerate();
  assert.equal(generated.content[0].text, FAKE_AGENT_REPLY);
});

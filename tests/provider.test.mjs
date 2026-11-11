import test from "node:test";
import assert from "node:assert/strict";
import { providerInfo, resolveProvider, SAFE_PROVIDER_INFO } from "../lib/provider.ts";
import {
  currentProviderInfo,
  loadProviderInfo,
  parseProviderInfo,
  resetProviderInfoForTests,
} from "../lib/provider-client.ts";

test("provider: with no setting, the key that is present decides", () => {
  assert.deepEqual(resolveProvider({ GEMINI_API_KEY: "g" }), { ok: true, provider: "gemini", apiKey: "g", source: "auto" });
  assert.deepEqual(resolveProvider({ META_API_KEY: "m" }), { ok: true, provider: "meta", apiKey: "m", source: "auto" });
});

test("provider: Gemini is the default when both keys are set", () => {
  const r = resolveProvider({ GEMINI_API_KEY: "g", META_API_KEY: "m" });
  assert.equal(r.ok && r.provider, "gemini");
});

test("provider: VOICE_PROVIDER overrides the default, in any letter case", () => {
  const r = resolveProvider({ VOICE_PROVIDER: " Meta ", GEMINI_API_KEY: "g", META_API_KEY: "m" });
  assert.deepEqual(r, { ok: true, provider: "meta", apiKey: "m", source: "explicit" });
});

test("provider: an explicit provider never borrows the other provider's key", () => {
  const r = resolveProvider({ VOICE_PROVIDER: "meta", GEMINI_API_KEY: "g" });
  assert.equal(r.ok, false);
  assert.equal(r.provider, "meta");
  assert.match(r.error, /META_API_KEY/);
});

test("provider: unknown names and missing keys are errors, and blank keys do not count", () => {
  assert.equal(resolveProvider({ VOICE_PROVIDER: "openai", GEMINI_API_KEY: "g" }).ok, false);
  assert.equal(resolveProvider({}).ok, false);
  assert.equal(resolveProvider({ GEMINI_API_KEY: "   " }).ok, false);
});

test("provider: each provider reports its engines and never a key", () => {
  assert.deepEqual(providerInfo("gemini"), { provider: "gemini", streamingAsr: false, neuralVoice: true, label: "Google Gemini" });
  assert.deepEqual(providerInfo("meta"), { provider: "meta", streamingAsr: true, neuralVoice: false, label: "Meta Muse" });
});

test("provider client: malformed answers are rejected", () => {
  assert.equal(parseProviderInfo(null), null);
  assert.equal(parseProviderInfo({ provider: "other" }), null);
  assert.deepEqual(parseProviderInfo({ provider: "meta", streamingAsr: true, neuralVoice: "yes" }), {
    provider: "meta", streamingAsr: true, neuralVoice: false, label: "",
  });
});

test("provider client: asks once, remembers the answer, and retries after a failure", async () => {
  resetProviderInfoForTests();
  assert.deepEqual(currentProviderInfo(), SAFE_PROVIDER_INFO);

  let calls = 0;
  const failing = async () => { calls += 1; throw new Error("offline"); };
  assert.deepEqual(await loadProviderInfo(failing), SAFE_PROVIDER_INFO);
  assert.deepEqual(currentProviderInfo(), SAFE_PROVIDER_INFO);

  const ok = async () => { calls += 1; return { ok: true, json: async () => providerInfo("meta") }; };
  const [a, b] = await Promise.all([loadProviderInfo(ok), loadProviderInfo(ok)]);
  assert.equal(a.provider, "meta");
  assert.equal(b.provider, "meta");
  assert.equal(calls, 2);
  await loadProviderInfo(ok);
  assert.equal(calls, 2);
  assert.equal(currentProviderInfo().streamingAsr, true);
  resetProviderInfoForTests();
});

test("provider client: the safe default uses only engines every provider has", () => {
  assert.equal(SAFE_PROVIDER_INFO.streamingAsr, false);
  assert.equal(SAFE_PROVIDER_INFO.neuralVoice, false);
});

test("provider route: answers per request from the environment and never returns a key", async () => {
  const { GET } = await import("../app/api/provider/route.ts");
  const saved = { ...process.env };
  const req = (origin = "http://localhost:3000") =>
    new Request("http://localhost:3000/api/provider", { headers: { Origin: origin, Host: "localhost:3000" } });
  try {
    delete process.env.VOICE_PROVIDER;
    process.env.GEMINI_API_KEY = "G_SECRET";
    process.env.META_API_KEY = "M_SECRET";
    let res = await GET(req());
    let text = await res.text();
    assert.equal(res.status, 200);
    assert.equal(JSON.parse(text).provider, "gemini");
    assert.equal(text.includes("SECRET"), false);

    process.env.VOICE_PROVIDER = "meta";
    res = await GET(req());
    assert.deepEqual(await res.json(), { provider: "meta", streamingAsr: true, neuralVoice: false, label: "Meta Muse" });

    delete process.env.META_API_KEY;
    assert.equal((await GET(req())).status, 500);
    assert.equal((await GET(req("http://evil.example"))).status, 403);
  } finally {
    for (const k of ["VOICE_PROVIDER", "GEMINI_API_KEY", "META_API_KEY"]) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
});

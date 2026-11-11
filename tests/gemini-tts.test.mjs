import test from "node:test";
import assert from "node:assert/strict";
import { handleTts, MAX_TTS_CHARS } from "../lib/tts-handler.ts";
import { createRateLimiter } from "../lib/request-guard.ts";

const GEMINI = { ok: true, provider: "gemini", apiKey: "SECRET_KEY", source: "auto" };
const META = { ok: true, provider: "meta", apiKey: "META_SECRET", source: "explicit" };
const NO_KEY = { ok: false, provider: null, error: "GEMINI_API_KEY or META_API_KEY is not configured on the server" };

function makeReq(body, origin = "http://localhost:3000") {
  return new Request("http://localhost:3000/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin, Host: "localhost:3000" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function deps(overrides = {}) {
  const calls = [];
  return {
    calls,
    resolve: () => GEMINI,
    synthesize: async (text, voice, apiKey) => {
      calls.push({ text, voice, apiKey });
      return { audio: "QUJD", sampleRate: 24000 };
    },
    limiter: createRateLimiter({ limit: 1000, windowMs: 60_000 }),
    cache: new Map(),
    inflight: new Map(),
    log: () => {},
    ...overrides,
  };
}

test("tts: a foreign origin is refused", async () => {
  const res = await handleTts(makeReq({ text: "Hello" }, "http://malicious-site.com"), deps());
  assert.equal(res.status, 403);
});

test("tts: a bad request is a 400 whatever keys the server has", async () => {
  for (const resolve of [() => GEMINI, () => META, () => NO_KEY]) {
    assert.equal((await handleTts(makeReq({ text: "" }), deps({ resolve }))).status, 400);
    assert.equal((await handleTts(makeReq({}), deps({ resolve }))).status, 400);
    assert.equal((await handleTts(makeReq("not json"), deps({ resolve }))).status, 400);
    assert.equal((await handleTts(makeReq({ text: "Hi", voice: "../../etc" }), deps({ resolve }))).status, 400);
  }
});

test("tts: text past the cap is refused before any upstream call", async () => {
  const d = deps();
  const res = await handleTts(makeReq({ text: "a".repeat(MAX_TTS_CHARS + 1) }), d);
  assert.equal(res.status, 413);
  assert.equal(d.calls.length, 0);
});

test("tts: no key is a 500; the Meta provider answers 501 so the browser voice speaks", async () => {
  assert.equal((await handleTts(makeReq({ text: "Hello" }), deps({ resolve: () => NO_KEY }))).status, 500);
  const d = deps({ resolve: () => META });
  assert.equal((await handleTts(makeReq({ text: "Hello" }), d)).status, 501);
  assert.equal(d.calls.length, 0);
});

test("tts: synthesises once, then serves the same line from cache", async () => {
  const d = deps();
  const first = await (await handleTts(makeReq({ text: "Welcome, Commander." }), d)).json();
  const second = await (await handleTts(makeReq({ text: "Welcome, Commander." }), d)).json();
  assert.deepEqual(first, { audio: "QUJD", sampleRate: 24000, cached: false });
  assert.equal(second.cached, true);
  assert.equal(d.calls.length, 1);
  assert.deepEqual(d.calls[0], { text: "Welcome, Commander.", voice: "Aoede", apiKey: "SECRET_KEY" });
});

test("tts: a prefetch and the real request for one line share one upstream call", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const d = deps();
  d.synthesize = async (text) => {
    d.calls.push(text);
    await gate;
    return { audio: "QUJD", sampleRate: 24000 };
  };
  const a = handleTts(makeReq({ text: "Name the company." }), d);
  const b = handleTts(makeReq({ text: "Name the company." }), d);
  await new Promise((resolve) => setTimeout(resolve, 5));
  release();
  const [ra, rb] = await Promise.all([a, b]);
  assert.equal(ra.status, 200);
  assert.equal(rb.status, 200);
  assert.equal(d.calls.length, 1);
});

test("tts: an upstream failure is a plain 502 with no upstream detail or key", async () => {
  const logged = [];
  const d = deps({
    synthesize: async () => { throw new Error("upstream said: bad key SECRET_KEY"); },
    log: (m) => logged.push(m),
  });
  const res = await handleTts(makeReq({ text: "Hello" }), d);
  assert.equal(res.status, 502);
  const body = JSON.stringify(await res.json());
  assert.equal(body.includes("SECRET_KEY"), false);
  assert.equal(body.includes("upstream said"), false);
  assert.equal(logged.length, 1);
  // A failed line is not cached; the next request tries again.
  assert.equal(d.cache.size, 0);
});

test("tts route: wired to the handler", async () => {
  const { POST } = await import("../app/api/tts/route.ts");
  const res = await POST(makeReq({ text: "Hello" }, "http://malicious-site.com"));
  assert.equal(res.status, 403);
});

test("tts: the upstream prompt asks for the line to be read aloud, not answered", async () => {
  const { synthesizeWithGemini, READ_ALOUD_DIRECTIVE } = await import("../lib/tts-handler.ts");
  const realFetch = globalThis.fetch;
  let sent = null;
  globalThis.fetch = async (url, init) => {
    sent = { url: String(url), body: JSON.parse(init.body), headers: init.headers };
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { data: "AAAA" } }] } }] }), { status: 200 });
  };
  try {
    const out = await synthesizeWithGemini("Didn't hear anything — say it again.", "Aoede", "k");
    assert.equal(out.audio, "AAAA");
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(sent.body.contents[0].parts[0].text, `${READ_ALOUD_DIRECTIVE}Didn't hear anything — say it again.`);
  assert.equal(sent.headers["x-goog-api-key"], "k");
  assert.ok(!sent.url.includes("key="));
});

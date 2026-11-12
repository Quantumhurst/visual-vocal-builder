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
    quota: { until: 0 },
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

test("tts: an upstream quota refusal pauses synthesis and says how long", async () => {
  const { UpstreamTtsError } = await import("../lib/tts-handler.ts");
  let t = 1_000_000;
  const logs = [];
  const d = deps({ now: () => t, log: (m) => logs.push(m) });
  let refuse = true;
  d.synthesize = async (text) => {
    d.calls.push(text);
    if (refuse) throw new UpstreamTtsError(429, 37);
    return { audio: "QUJD", sampleRate: 24000 };
  };
  const first = await handleTts(makeReq({ text: "Line one" }), d);
  assert.equal(first.status, 429);
  assert.equal(first.headers.get("Retry-After"), "37");
  // Inside the window: refused without calling upstream.
  t += 10_000;
  const second = await handleTts(makeReq({ text: "Line two" }), d);
  assert.equal(second.status, 429);
  assert.equal(second.headers.get("Retry-After"), "27");
  assert.equal(d.calls.length, 1);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /quota exhausted; pausing neural voice for 37s/);
  // After the window: upstream is tried again.
  t += 28_000;
  refuse = false;
  const third = await handleTts(makeReq({ text: "Line three" }), d);
  assert.equal(third.status, 200);
  assert.equal(d.calls.length, 2);
});

test("tts: a cached line still plays during a quota pause", async () => {
  let t = 5_000;
  const d = deps({ now: () => t, quota: { until: 60_000 } });
  d.cache.set("Aoede:Pick Mars", { audio: "QUJD", sampleRate: 24000 });
  const hit = await handleTts(makeReq({ text: "Pick Mars" }), d);
  assert.equal(hit.status, 200);
  const miss = await handleTts(makeReq({ text: "Something new" }), d);
  assert.equal(miss.status, 429);
  assert.equal(d.calls.length, 0);
});

test("tts: other upstream failures stay a plain 502 and do not pause", async () => {
  const { UpstreamTtsError } = await import("../lib/tts-handler.ts");
  const d = deps();
  d.synthesize = async () => {
    throw new UpstreamTtsError(400);
  };
  const res = await handleTts(makeReq({ text: "Hello" }), d);
  assert.equal(res.status, 502);
  assert.equal(d.quota.until, 0);
});

test("tts: retry delay is read from the header or Google's RetryInfo, then clamped", async () => {
  const { parseRetryAfterSec, quotaCooldownSec, DEFAULT_QUOTA_COOLDOWN_SEC } = await import("../lib/tts-handler.ts");
  assert.equal(parseRetryAfterSec("12", null), 12);
  const body = { error: { details: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "41s" }] } };
  assert.equal(parseRetryAfterSec(null, body), 41);
  assert.equal(parseRetryAfterSec(null, { error: {} }), null);
  assert.equal(quotaCooldownSec(null), DEFAULT_QUOTA_COOLDOWN_SEC);
  assert.equal(quotaCooldownSec(1), 5);
  assert.equal(quotaCooldownSec(10_000), 300);
  assert.equal(quotaCooldownSec(12.2), 13);
});

test("tts: synthesizeWithGemini turns a 429 into a quota error with its retry delay", async () => {
  const { synthesizeWithGemini, UpstreamTtsError } = await import("../lib/tts-handler.ts");
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: { code: 429, details: [{ retryDelay: "22s" }] } }), { status: 429 });
  try {
    await assert.rejects(synthesizeWithGemini("Hi", "Aoede", "k"), (err) => {
      assert.ok(err instanceof UpstreamTtsError);
      assert.equal(err.status, 429);
      assert.equal(err.retryAfterSec, 22);
      return true;
    });
  } finally {
    globalThis.fetch = realFetch;
  }
});

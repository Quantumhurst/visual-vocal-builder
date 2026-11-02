import { test } from "node:test";
import assert from "node:assert/strict";
import { handleTranscribe } from "../lib/transcribe-handler.ts";
import { createRateLimiter, MAX_PCM_BYTES } from "../lib/request-guard.ts";

function freshDeps(logs, transcript = "hello world") {
  return {
    transcribe: async () => transcript,
    limiter: createRateLimiter({ limit: 20, windowMs: 60000 }),
    log: (e) => logs.push(e),
  };
}
function makeReq(bodyParts, headers = {}) {
  const form = new FormData();
  for (const [k, v] of Object.entries(bodyParts)) form.append(k, v);
  return new Request("http://localhost:3000/api/transcribe", { method: "POST", body: form, headers: { host: "localhost:3000", ...headers } });
}

test("403 bad origin", async () => {
  const logs = [];
  const req = makeReq({ audio: new Blob([new Uint8Array([0,0])]) }, { origin: "https://evil.example" });
  const res = await handleTranscribe(req, freshDeps(logs));
  assert.equal(res.status, 403);
});
test("429 over limit", async () => {
  const logs = [];
  const deps = freshDeps(logs);
  deps.limiter = createRateLimiter({ limit: 1, windowMs: 60000 });
  const r1 = await handleTranscribe(makeReq({ audio: new Blob([new Uint8Array([0,0])]) }), deps);
  assert.equal(r1.status, 200);
  const r2 = await handleTranscribe(makeReq({ audio: new Blob([new Uint8Array([0,0])]) }), deps);
  assert.equal(r2.status, 429);
  assert.ok(r2.headers.get("Retry-After"));
});
test("400 missing/empty/odd", async () => {
  const logs = [];
  assert.equal((await handleTranscribe(makeReq({}), freshDeps(logs))).status, 400);
  assert.equal((await handleTranscribe(makeReq({ audio: new Blob([]) }), freshDeps(logs))).status, 400);
  assert.equal((await handleTranscribe(makeReq({ audio: new Blob([new Uint8Array([1])]) }), freshDeps(logs))).status, 400);
});
test("413 oversize", async () => {
  const logs = [];
  const big = new Blob([new Uint8Array(MAX_PCM_BYTES + 2)]);
  assert.equal((await handleTranscribe(makeReq({ audio: big }), freshDeps(logs))).status, 413);
});
test("200 with stubbed transcribe, no transcript text in log", async () => {
  const logs = [];
  const res = await handleTranscribe(makeReq({ audio: new Blob([new Uint8Array([0,0,1,0])]) }), freshDeps(logs, "SECRET_TRANSCRIPT_TEXT"));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.transcript, "SECRET_TRANSCRIPT_TEXT");
  assert.equal(JSON.stringify(logs).includes("SECRET_TRANSCRIPT_TEXT"), false);
  assert.deepEqual(Object.keys(logs[0]).sort(), ["audioBytes", "transcriptLength"]);
  assert.equal(logs[0].transcriptLength, "SECRET_TRANSCRIPT_TEXT".length);
});

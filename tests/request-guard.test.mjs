import { test } from "node:test";
import assert from "node:assert/strict";
import { checkOrigin, createRateLimiter, clientKey, MAX_PCM_BYTES } from "../lib/request-guard.ts";

test("origin match/mismatch/absent", () => {
  assert.equal(checkOrigin(null, "localhost:3000"), true);
  assert.equal(checkOrigin(undefined, "localhost:3000"), true);
  assert.equal(checkOrigin("http://localhost:3000", "localhost:3000"), true);
  assert.equal(checkOrigin("https://evil.example", "localhost:3000"), false);
  assert.equal(checkOrigin("not a url", "localhost:3000"), false);
});
test("MAX_PCM_BYTES is 60s 16k mono PCM16", () => { assert.equal(MAX_PCM_BYTES, 1920000); });
test("limiter allows N then blocks, resets after window", () => {
  let t = 1000;
  const lim = createRateLimiter({ limit: 3, windowMs: 60000, now: () => t });
  assert.equal(lim("a").ok, true);
  assert.equal(lim.check("a").ok, true);
  assert.equal(lim("a").ok, true);
  const blocked = lim("a");
  assert.equal(blocked.ok, false);
  assert.ok(blocked.retryAfterSec >= 1);
  assert.equal(lim("b").ok, true);
  t += 60001;
  assert.equal(lim("a").ok, true);
});
test("clientKey prefers x-forwarded-for first entry", () => {
  const req = new Request("http://x/", { headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8", "x-real-ip": "9.9.9.9" } });
  assert.equal(clientKey(req), "1.2.3.4");
  const req2 = new Request("http://x/", { headers: { "x-real-ip": "9.9.9.9" } });
  assert.equal(clientKey(req2), "9.9.9.9");
  assert.equal(clientKey(new Request("http://x/")), "local");
});

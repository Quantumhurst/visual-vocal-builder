import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeTimings } from "../lib/turn-timing.ts";

test("summary formats stage lags and skips missing stages", () => {
  const out = summarizeTimings({ micStart: 1000, firstPartial: 1180, finalTranscript: 3100, firstToolCall: 4400, firstPaint: 4450, done: 8800, speechEnd: 12400, rearm: 12600, hostChars: 42 });
  assert.match(out, /partial 180ms/);
  assert.match(out, /final 2\.1s/);
  assert.match(out, /tool 3\.4s/);
  assert.match(out, /done 7\.8s/);
  assert.match(out, /speechEnd 11\.4s/);
  assert.match(out, /rearm 11\.6s/);
  assert.match(out, /host 42ch/);
  assert.match(summarizeTimings({}), /partial —/);
});

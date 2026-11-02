import { test } from "node:test";
import assert from "node:assert/strict";
import { toPcm16k, concatFloat32 } from "../lib/pcm.ts";

test("48k -> 16k length is a third", () => {
  const input = new Float32Array(4800).fill(0);
  assert.equal(toPcm16k(input, 48000).length, 1600);
});
test("clamps at +/-1", () => {
  const out = toPcm16k(new Float32Array([2, -2, 0.5]), 16000);
  assert.equal(out[0], 32767);
  assert.equal(out[1], -32767);
  assert.equal(out[2], Math.round(0.5 * 32767));
});
test("sine-wave sample check", () => {
  const rate = 48000;
  const samples = new Float32Array(rate);
  for (let i = 0; i < rate; i++) samples[i] = Math.sin(2 * Math.PI * 440 * i / rate);
  const out = toPcm16k(samples, rate);
  assert.equal(out.length, 16000);
  // first sample near 0, quarter period (~ at 16k, 440Hz period ~36 samples) near peak
  assert.ok(Math.abs(out[0]) < 2000);
  const peak = Math.max(...Array.from(out.slice(0, 40)).map(Math.abs));
  assert.ok(peak > 30000);
});
test("concatFloat32", () => {
  assert.deepEqual(Array.from(concatFloat32([new Float32Array([1,2]), new Float32Array([3])])), [1,2,3]);
});

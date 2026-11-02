// PCM conversion helpers. Pure, unit-testable.
export function toPcm16k(samples: Float32Array, inputRate: number): Int16Array {
  const targetRate = 16000;
  if (!inputRate || inputRate <= 0) throw new Error("invalid inputRate");
  if (samples.length === 0) return new Int16Array(0);
  const ratio = inputRate / targetRate;
  const outLen = Math.max(0, Math.round(samples.length / ratio));
  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.max(start + 1, Math.floor((i + 1) * ratio));
    let sum = 0;
    let n = 0;
    for (let j = start; j < end && j < samples.length; j++) { sum += samples[j]; n++; }
    const avg = n ? sum / n : 0;
    const clamped = Math.min(1, Math.max(-1, avg));
    out[i] = Math.round(clamped * 32767);
  }
  return out;
}

export function concatFloat32(chunks: Float32Array[]): Float32Array {
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Float32Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

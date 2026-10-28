// Equity split invariant — written in-window for Day 2 beat 2.
//
// THE INVARIANT: founder percents always total exactly 100.
// Every surface (voice-agent action, slider drag) funnels through
// setFounderShare(), so no surface can leave shared state inconsistent.

export type FounderShare = {
  name: string; // fictional demo founder name only
  percent: number; // integer percent; all founders total 100
};

export function totalPercent(shares: FounderShare[]): number {
  return shares.reduce((sum, founder) => sum + founder.percent, 0);
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

// Distribute `remainder` integer points across `weights` proportionally,
// fixing rounding on the largest fractional parts so the parts sum
// exactly to `remainder`.
function distribute(remainder: number, weights: number[]): number[] {
  const count = weights.length;
  if (count === 0) return [];
  if (remainder <= 0) return weights.map(() => 0);
  const weightSum = weights.reduce((sum, w) => sum + w, 0);
  const raw = weights.map((w) =>
    weightSum > 0 ? (remainder * w) / weightSum : remainder / count,
  );
  const parts = raw.map((value) => Math.floor(value));
  let leftover = remainder - parts.reduce((sum, v) => sum + v, 0);
  const byFraction = raw
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction);
  for (let i = 0; leftover > 0; i = (i + 1) % count) {
    parts[byFraction[i].index] += 1;
    leftover -= 1;
  }
  return parts;
}

// THE shared update path. Set one founder to `target` percent; every
// other founder absorbs the remainder proportionally to their current
// share. Example (the beat-2 demo): shares 60/40, set founder 0 to 70
// -> 70/30, and the agent notes the adjustment. Total stays 100.
export function setFounderShare(
  shares: FounderShare[],
  index: number,
  target: number,
): FounderShare[] {
  if (shares.length === 0) return shares;
  const safeIndex = Math.min(shares.length - 1, Math.max(0, index));
  const targetInt = clampPercent(target);
  if (shares.length === 1) {
    return [{ ...shares[0], percent: 100 }];
  }
  const remainder = 100 - targetInt;
  const otherWeights = shares
    .filter((_, i) => i !== safeIndex)
    .map((founder) => Math.max(0, founder.percent));
  const otherParts = distribute(remainder, otherWeights);
  let otherCursor = 0;
  return shares.map((founder, i) =>
    i === safeIndex
      ? { ...founder, percent: targetInt }
      : { ...founder, percent: otherParts[otherCursor++] },
  );
}

// Repair path for a raw split that may not total 100 (e.g. an agent
// proposes 70 and 40): scale proportionally to exactly 100. A zero or
// empty split becomes an equal split.
export function normalizeShares(shares: FounderShare[]): FounderShare[] {
  if (shares.length === 0) return shares;
  if (shares.length === 1) return [{ ...shares[0], percent: 100 }];
  const weights = shares.map((founder) => Math.max(0, founder.percent));
  const parts = distribute(100, weights);
  return shares.map((founder, i) => ({ ...founder, percent: parts[i] }));
}

export function assertTotals100(shares: FounderShare[]): boolean {
  return shares.length === 0 || totalPercent(shares) === 100;
}

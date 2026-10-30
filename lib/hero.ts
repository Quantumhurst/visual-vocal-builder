// Pure hero logic for the Day 4 PixiJS landing hero (components/GalaxyHero.tsx).
// Kept free of Pixi/DOM imports so the selection, highlight, fallback, and
// lifecycle contracts are unit-testable in Node (tests/hero.test.mjs).
// The hero never invents a jurisdiction: every name comes from the caller,
// which passes DEMO_JURISDICTIONS from lib/demo-data.ts.

export type HeroPlanet = {
  name: string;
  x: number; // fraction of hero width, 0..1
  y: number; // fraction of hero height, 0..1
  radius: number;
  color: number;
};

// Fixed layout for exactly the DEMO jurisdictions, in caller order.
// Colors are invented demo art (drawn with Graphics, no image assets).
const PLANET_STYLE = [
  { x: 0.2, y: 0.52, radius: 44, color: 0xd1603d }, // Mars-like rust
  { x: 0.5, y: 0.42, radius: 38, color: 0x9fd8e8 }, // Europa-like ice
  { x: 0.8, y: 0.55, radius: 50, color: 0x8f7fe8 }, // Andromeda-like violet
];

export function heroPlanets(names: string[]): HeroPlanet[] {
  return names.map((name, i) => {
    const s = PLANET_STYLE[i % PLANET_STYLE.length];
    return { name, x: s.x, y: s.y, radius: s.radius, color: s.color };
  });
}

// THE shared selection rule: clicking a hero planet (canvas or DOM button)
// selects exactly that jurisdiction, validated against the DEMO list.
// An unknown name changes nothing — the hero cannot invent a jurisdiction.
export function selectFromHero(
  jurisdictions: string[],
  clicked: string,
): string | null {
  const match = jurisdictions.find(
    (j) => j.toLowerCase() === clicked.toLowerCase(),
  );
  return match ?? null;
}

// Highlight is derived from shared state only (voice or click): the hero
// holds no copy of the selection. Returns the planet index to glow, or -1.
export function highlightIndex(names: string[], selected: string | null): number {
  if (!selected) return -1;
  return names.findIndex((n) => n === selected);
}

// Fallback rule: no WebGL/WebGPU -> static DOM planets, never a blank hero.
export function shouldUseDomFallback(webglAvailable: boolean): boolean {
  return !webglAvailable;
}

export function detectWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(
      canvas.getContext("webgl2") || canvas.getContext("webgl"),
    );
  } catch {
    return false;
  }
}

// Seeded PRNG (mulberry32): stable starfield across renders/frames.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type HeroStar = {
  x: number;
  y: number;
  r: number;
  alpha: number;
  layer: 0 | 1; // 0 = far (slower), 1 = near (faster)
  speed: number; // px per 60fps frame
  phase: number; // twinkle phase, radians
  twinkleSpeed: number; // radians per ms
};

// Precomputed once by the component; the ticker only mutates x/alpha.
export function starfieldPoints(
  width: number,
  height: number,
  count = 140,
  seed = 1337,
): HeroStar[] {
  const rand = mulberry32(seed);
  const stars: HeroStar[] = [];
  for (let i = 0; i < count; i++) {
    const layer = (rand() < 0.55 ? 0 : 1) as 0 | 1;
    stars.push({
      x: rand() * width,
      y: rand() * height,
      r: layer === 0 ? 0.6 + rand() * 0.9 : 1.1 + rand() * 1.4,
      alpha: layer === 0 ? 0.35 + rand() * 0.35 : 0.6 + rand() * 0.4,
      layer,
      speed: layer === 0 ? 0.03 + rand() * 0.03 : 0.1 + rand() * 0.08,
      phase: rand() * Math.PI * 2,
      twinkleSpeed: 0.0008 + rand() * 0.0016,
    });
  }
  return stars;
}

// Slow pulse ring around the selected planet (radius grows, alpha fades, loops).
export function pulseRing(radius: number, elapsedMs: number, periodMs = 1800) {
  const phase = (((elapsedMs % periodMs) + periodMs) % periodMs) / periodMs;
  return { radius: radius + 10 + phase * 16, alpha: 0.75 * (1 - phase), phase };
}

// One-shot burst on select: expands and fades over 600ms, then is done.
export function burstRing(radius: number, ageMs: number, durationMs = 600) {
  if (ageMs < 0 || ageMs >= durationMs) return null;
  const phase = ageMs / durationMs;
  return { radius: radius + 6 + phase * 38, alpha: 0.9 * (1 - phase), phase };
}

// Lifecycle guard: tracks a Pixi application's destroyed state so unmount
// teardown is idempotent and testable without a renderer.
export function createHeroLifecycle() {
  let destroyed = false;
  return {
    destroy(destroyFn?: () => void) {
      if (destroyed) return;
      destroyed = true;
      destroyFn?.();
    },
    isDestroyed: () => destroyed,
  };
}

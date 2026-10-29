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

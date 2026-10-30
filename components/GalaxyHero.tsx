"use client";

// Day 4: the ONE PixiJS island — a landing hero inside the existing Canvas.
// PixiJS v8 patterns only (Application + await app.init, Container, Graphics,
// ticker), per https://pixijs.com/llms. Planets come from the shared agent
// state (DEMO_JURISDICTIONS via Canvas), never hard-coded copies. The hero
// holds no selection state: highlight derives from `selected`, clicks call
// `onSelect` — the same shared-state write the jurisdiction table uses.

import { useEffect, useRef, useState } from "react";
import {
  createHeroLifecycle,
  detectWebGL,
  heroPlanets,
  highlightIndex,
  selectFromHero,
  shouldUseDomFallback,
} from "../lib/hero";
import type { JurisdictionRow } from "../lib/state";

type Props = {
  rows: JurisdictionRow[];
  selected: string | null;
  onSelect: (jurisdiction: string) => void;
};

const WIDTH = 860;
const HEIGHT = 320;

export default function GalaxyHero({ rows, selected, onSelect }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const selectedRef = useRef<string | null>(selected);
  const hoverRef = useRef<number>(-1);
  const redrawRef = useRef<(() => void) | null>(null);
  const [useFallback, setUseFallback] = useState<boolean>(
    () => typeof window !== "undefined" && shouldUseDomFallback(detectWebGL()),
  );

  const names = rows.map((r) => r.jurisdiction);
  const planets = heroPlanets(names);
  const active = highlightIndex(names, selected);

  // Voice (or table) selection updates the hero highlight from shared state.
  useEffect(() => {
    selectedRef.current = selected;
    redrawRef.current?.();
  }, [selected]);

  useEffect(() => {
    if (useFallback) return;
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    const lifecycle = createHeroLifecycle();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    (async () => {
      const { Application, Container, Graphics, Text, TextStyle } =
        await import("pixi.js");
      if (cancelled) return;
      const app = new Application();
      try {
        await app.init({
          width: WIDTH,
          height: HEIGHT,
          background: "#0b1026",
          antialias: true,
        });
      } catch {
        if (!cancelled) setUseFallback(true);
        return;
      }
      if (cancelled) {
        lifecycle.destroy(() => app.destroy(true, { children: true }));
        return;
      }
      host.appendChild(app.canvas);
      (app.canvas as HTMLCanvasElement).setAttribute(
        "aria-label",
        "Interactive galaxy scene with three demo planets: " +
          names.join(", ") +
          ". Activate a planet button below the scene to select it.",
      );

      const scene = new Container();
      app.stage.addChild(scene);

      // Starfield: precomputed once; ticker only drifts x (no per-frame allocs).
      const stars = new Graphics();
      const starPts: { x: number; y: number; r: number }[] = [];
      for (let i = 0; i < 140; i++) {
        starPts.push({
          x: (i * 613) % WIDTH,
          y: (i * 389) % HEIGHT,
          r: 1 + ((i * 7) % 3) * 0.6,
        });
      }
      const drawStars = () => {
        stars.clear();
        for (const s of starPts) stars.circle(s.x, s.y, s.r);
        stars.fill({ color: 0xffffff, alpha: 0.8 });
      };
      drawStars();
      scene.addChild(stars);

      const planetNodes = planets.map((planet, i) => {
        const node = new Container();
        node.x = planet.x * WIDTH;
        node.y = planet.y * HEIGHT;
        const halo = new Graphics();
        const body = new Graphics();
        node.addChild(halo, body);
        const label = new Text({
          text: planet.name,
          style: new TextStyle({ fill: "#ffffff", fontSize: 15, fontFamily: "sans-serif" }),
        });
        label.anchor.set(0.5, 0);
        label.y = planet.radius + 10;
        node.addChild(label);
        node.eventMode = "static";
        node.cursor = "pointer";
        node.on("pointerover", () => { hoverRef.current = i; redrawRef.current?.(); });
        node.on("pointerout", () => { hoverRef.current = -1; redrawRef.current?.(); });
        node.on("pointertap", () => {
          const pick = selectFromHero(names, planet.name);
          if (pick) onSelect(pick);
        });
        scene.addChild(node);
        return { node, halo, body, planet };
      });

      const redraw = () => {
        const sel = highlightIndex(names, selectedRef.current);
        for (let i = 0; i < planetNodes.length; i++) {
          const { halo, body, planet } = planetNodes[i];
          const glowing = i === sel || i === hoverRef.current;
          halo.clear();
          if (glowing) {
            halo.circle(0, 0, planet.radius + 14);
            halo.fill({ color: planet.color, alpha: 0.35 });
          }
          body.clear();
          body.circle(0, 0, planet.radius);
          body.fill({ color: planet.color, alpha: i === sel ? 1 : 0.85 });
          body.circle(-planet.radius * 0.3, -planet.radius * 0.3, planet.radius * 0.18);
          body.fill({ color: 0xffffff, alpha: 0.35 });
        }
      };
      redrawRef.current = redraw;
      redraw();

      if (!reduced) {
        app.ticker.add(() => {
          for (const s of starPts) {
            s.x -= 0.15;
            if (s.x < 0) s.x += WIDTH;
          }
          drawStars();
        });
      }

      // Stash teardown on the host element for the cleanup closure below.
      (host as unknown as { __heroDestroy?: () => void }).__heroDestroy = () =>
        lifecycle.destroy(() => {
          app.ticker.stop();
          app.stage.removeAllListeners();
          app.destroy(true, { children: true });
        });
    })();

    return () => {
      cancelled = true;
      redrawRef.current = null;
      const hostEl = host as unknown as { __heroDestroy?: () => void };
      hostEl.__heroDestroy?.();
      delete hostEl.__heroDestroy;
      host.replaceChildren();
    };
    // Scene is built once from the DEMO rows; selection flows via refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useFallback]);

  return (
    <section aria-label="Galaxy hero — pick a demo world">
      <h2>Incorporate by voice</h2>
      <p>
        <span style={{ border: "1px solid currentColor", borderRadius: "999px", padding: "0.1rem 0.6rem", fontSize: "0.8rem" }}>DEMO</span>{" "}
        Pick a fictional world below — or ask by voice — and the
        incorporation walk starts there.
      </p>

      {useFallback ? (
        <div role="img" aria-label={"Static galaxy scene with three demo planets: " + names.join(", ")}>
          <div style={{ display: "flex", gap: "2rem", background: "#0b1026", padding: "2rem", borderRadius: "8px", justifyContent: "center" }}>
            {planets.map((planet, i) => (
              <div key={planet.name} style={{ textAlign: "center", color: "#fff" }}>
                <div style={{ width: planet.radius * 2, height: planet.radius * 2, borderRadius: "50%", background: `#${planet.color.toString(16).padStart(6, "0")}`, margin: "0 auto", boxShadow: i === active ? "0 0 24px #fff" : undefined }} />
                <div>{planet.name}</div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div ref={hostRef} />
      )}

      <div>
        {planets.map((planet, i) => (
          <button
            key={planet.name}
            onClick={() => { const pick = selectFromHero(names, planet.name); if (pick) onSelect(pick); }}
            aria-pressed={i === active}
          >
            {planet.name}
          </button>
        ))}
      </div>
      {selected ? <p>Selected jurisdiction: {selected}</p> : null}
    </section>
  );
}

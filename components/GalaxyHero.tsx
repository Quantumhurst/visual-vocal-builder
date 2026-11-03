"use client";

// Day 4: the ONE PixiJS island — a landing hero inside the existing Canvas.
// PixiJS v8 patterns only (Application + await app.init, Container, Graphics,
// ticker), per https://pixijs.com/llms. Planets come from the shared agent
// state (DEMO_JURISDICTIONS via Canvas), never hard-coded copies. The hero
// holds no selection state: highlight derives from `selected`, clicks call
// `onSelect` — the same shared-state write the jurisdiction table uses.

import { useEffect, useRef, useState } from "react";
import {
  burstRing,
  createHeroLifecycle,
  detectWebGL,
  heroPlanets,
  highlightIndex,
  pulseRing,
  selectFromHero,
  shouldUseDomFallback,
  starfieldPoints,
} from "../lib/hero";
import type { JurisdictionRow } from "../lib/state";

type Props = {
  rows: JurisdictionRow[];
  selected: string | null;
  onSelect: (jurisdiction: string) => void;
};

const WIDTH = 960;
const HEIGHT = 620;

export default function GalaxyHero({ rows, selected, onSelect }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const selectedRef = useRef<string | null>(selected);
  const hoverRef = useRef<number>(-1);
  const redrawRef = useRef<(() => void) | null>(null);
  const burstRef = useRef<((index: number) => void) | null>(null);
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
      const { Application, Circle, Container, Graphics, Text, TextStyle } =
        await import("pixi.js");
      if (cancelled) return;
      const app = new Application();
      try {
        await app.init({
          width: WIDTH,
          height: HEIGHT,
          backgroundAlpha: 0,
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
      (app.canvas as HTMLCanvasElement).style.width = "100%";
      (app.canvas as HTMLCanvasElement).style.height = "100%";
      (app.canvas as HTMLCanvasElement).style.objectFit = "contain";
      (app.canvas as HTMLCanvasElement).setAttribute(
        "aria-label",
        "Interactive galaxy scene with three demo planets: " +
          names.join(", ") +
          ". Activate a planet button below the scene to select it.",
      );

      const scene = new Container();
      app.stage.addChild(scene);

      // Starfield: seeded points precomputed once; ticker only mutates
      // each star node's x/alpha (no per-frame allocation).
      const starPts = starfieldPoints(WIDTH, HEIGHT, 140, 1337);
      const starNodes = starPts.map((s) => {
        const g = new Graphics();
        g.circle(0, 0, s.r);
        g.fill({ color: 0xffffff, alpha: 1 });
        g.x = s.x;
        g.y = s.y;
        g.alpha = s.alpha;
        scene.addChild(g);
        return g;
      });

      const planetNodes = planets.map((planet, i) => {
        const node = new Container();
        node.x = planet.x * WIDTH;
        node.y = planet.y * HEIGHT;
        const halo = new Graphics();
        const pulse = new Graphics();
        pulse.circle(0, 0, planet.radius + 10);
        pulse.stroke({ color: planet.color, width: 2, alpha: 0.8 });
        pulse.visible = false;
        const body = new Graphics();
        node.addChild(pulse, halo, body);
        const label = new Text({
          text: planet.name,
          style: new TextStyle({ fill: "#ffffff", fontSize: 16, fontFamily: "sans-serif" }),
        });
        label.anchor.set(0.5, 0);
        label.y = planet.radius + 10;
        node.addChild(label);
        node.hitArea = new Circle(0, 0, planet.radius + 16);
        node.eventMode = "static";
        node.cursor = "pointer";
        node.on("pointerover", () => { hoverRef.current = i; redrawRef.current?.(); });
        node.on("pointerout", () => { hoverRef.current = -1; redrawRef.current?.(); });
        node.on("pointertap", () => {
          const pick = selectFromHero(names, planet.name);
          if (pick) {
            burstRef.current?.(i);
            onSelect(pick);
          }
        });
        scene.addChild(node);
        return { node, halo, body, pulse, planet };
      });

      // Fixed burst pool: reused ring graphics, no per-click allocation.
      let elapsedMs = 0;
      const burstPool = Array.from({ length: 4 }, () => {
        const g = new Graphics();
        g.visible = false;
        scene.addChild(g);
        return { g, start: -1, planetIndex: -1 };
      });
      let burstSlot = 0;
      burstRef.current = (index: number) => {
        if (reduced || index < 0 || index >= planetNodes.length) return;
        const slot = burstPool[burstSlot % burstPool.length];
        burstSlot++;
        const planet = planetNodes[index].planet;
        slot.start = elapsedMs;
        slot.planetIndex = index;
        slot.g.clear();
        slot.g.circle(0, 0, planet.radius + 6);
        slot.g.stroke({ color: planet.color, width: 3, alpha: 0.9 });
        slot.g.x = planet.x * WIDTH;
        slot.g.y = planet.y * HEIGHT;
        slot.g.visible = true;
      };

      const redraw = () => {
        const sel = highlightIndex(names, selectedRef.current);
        for (let i = 0; i < planetNodes.length; i++) {
          const { halo, body, planet } = planetNodes[i];
          if (reduced) planetNodes[i].node.scale.set(i === hoverRef.current ? 1.15 : i === sel ? 1.1 : 1);
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
        app.ticker.add((ticker) => {
          elapsedMs += ticker.deltaMS;
          const dt = ticker.deltaTime;
          for (let i = 0; i < starPts.length; i++) {
            const s = starPts[i];
            s.x -= s.speed * dt;
            if (s.x < -s.r) s.x += WIDTH + s.r * 2;
            const g = starNodes[i];
            g.x = s.x;
            g.alpha = s.alpha * (0.65 + 0.35 * Math.sin(elapsedMs * s.twinkleSpeed + s.phase));
          }
          const sel = highlightIndex(names, selectedRef.current);
          for (let i = 0; i < planetNodes.length; i++) {
            const entry = planetNodes[i];
            const target = i === hoverRef.current ? 1.15 : i === sel ? 1.1 : 1;
            const cur = entry.node.scale.x;
            entry.node.scale.set(cur + (target - cur) * 0.18, cur + (target - cur) * 0.18);
          }
          for (let i = 0; i < planetNodes.length; i++) {
            const { pulse, planet } = planetNodes[i];
            if (i === sel) {
              const frame = pulseRing(planet.radius, elapsedMs);
              pulse.visible = true;
              const s = frame.radius / (planet.radius + 10);
              pulse.scale.set(s, s);
              pulse.alpha = frame.alpha;
            } else {
              pulse.visible = false;
            }
          }
          for (const slot of burstPool) {
            if (slot.start < 0) continue;
            const frame = burstRing(planetNodes[slot.planetIndex].planet.radius, elapsedMs - slot.start);
            if (!frame) {
              slot.start = -1;
              slot.g.visible = false;
            } else {
              const base = planetNodes[slot.planetIndex].planet.radius + 6;
              const s = frame.radius / base;
              slot.g.scale.set(s, s);
              slot.g.alpha = frame.alpha;
            }
          }
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
      burstRef.current = null;
      const hostEl = host as unknown as { __heroDestroy?: () => void };
      hostEl.__heroDestroy?.();
      delete hostEl.__heroDestroy;
      host.replaceChildren();
    };
    // Scene is built once from the DEMO rows; selection flows via refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useFallback]);

  return (
    <section aria-label="Galaxy hero — pick a demo world" className="stage-scene hero-scene">
      <div className="stage-title-row">
        <h2 className="stage-title">Mission 1: pick your home base</h2>
        <span className="chip chip-demo">DEMO WORLDS</span>
      </div>
      <p className="stage-desc">
        Pick a fictional world — or ask by voice — and the incorporation walk starts there.
      </p>

      {useFallback ? (
        <div
          role="img"
          aria-label={"Static galaxy scene with three demo planets: " + names.join(", ")}
          className="hero-fallback"
        >
          {planets.map((planet, i) => (
            <div key={planet.name} className="fallback-planet">
              <div
                className="fallback-body"
                style={{
                  width: planet.radius * 1.7,
                  height: planet.radius * 1.7,
                  background: `#${planet.color.toString(16).padStart(6, "0")}`,
                  boxShadow: i === active ? "0 0 28px #fff" : undefined,
                }}
              />
              <div className="fallback-label">{planet.name}</div>
            </div>
          ))}
        </div>
      ) : (
        <div ref={hostRef} className="pixi-host" />
      )}

      <div className="planet-picker" aria-label="Select a demo world">
        {planets.map((planet, i) => (
          <button
            key={planet.name}
            type="button"
            className="planet-chip"
            onClick={() => {
              const pick = selectFromHero(names, planet.name);
              if (pick) {
                burstRef.current?.(i);
                onSelect(pick);
              }
            }}
            aria-pressed={i === active}
          >
            <span
              className="planet-dot"
              aria-hidden="true"
              style={{ background: `#${planet.color.toString(16).padStart(6, "0")}` }}
            />
            {planet.name}
          </button>
        ))}
      </div>
      {selected ? <p className="stage-status">HOME BASE LOCKED · {selected}</p> : <p className="stage-status is-dim">NO HOME BASE SELECTED</p>}
    </section>
  );
}

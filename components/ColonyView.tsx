"use client";

// Day 8: the colony board — the second Pixi island. It reads the same
// shared state as every other beat and writes none: checklist ticks
// build structures, the equity split moves the crew-quarters wall,
// and preparing the lawyer package launches the rocket. All mapping
// lives in lib/colony.ts; this file only draws it. Pixi lifecycle,
// starfield, and fallback mirror components/GalaxyHero.tsx (Day 4/7).

import { useEffect, useRef, useState } from "react";
import {
  colonyPalette,
  colonyProgress,
  colonyStructures,
  crewQuarters,
  launchFrame,
  launchState,
} from "../lib/colony";
import {
  burstRing,
  createHeroLifecycle,
  detectWebGL,
  shouldUseDomFallback,
  starfieldPoints,
} from "../lib/hero";
import type { ChecklistItem } from "../lib/state";
import type { FounderShare } from "../lib/equity";

type Props = {
  selected: string | null;
  checklist: ChecklistItem[];
  founders: FounderShare[];
  lawyerPackage: string;
};

const WIDTH = 960;
const HEIGHT = 620;
const GROUND_H = 64;
const QUARTER_COLORS = [0x7aa2ff, 0xffd166, 0x8fe3b0, 0xff8fa3, 0xb18cff];

export default function ColonyView({ selected, checklist, founders, lawyerPackage }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const redrawRef = useRef<(() => void) | null>(null);
  const burstRef = useRef<((x: number) => void) | null>(null);
  const stateRef = useRef({ selected, checklist, founders, lawyerPackage });
  const prevBuiltRef = useRef<number>(-1);
  const prevSelectedRef = useRef<string | null>(null);
  const [landing, setLanding] = useState<string | null>(null);
  const [useFallback, setUseFallback] = useState<boolean>(
    () => typeof window !== "undefined" && shouldUseDomFallback(detectWebGL()),
  );

  const structures = colonyStructures(checklist);
  const progress = colonyProgress(checklist);
  const quarters = crewQuarters(founders);
  const launch = launchState(checklist, lawyerPackage);

  // Shared-state changes redraw the board; a newly built structure bursts.
  // A new home-base selection lands the pad: burst on the first structure.
  useEffect(() => {
    stateRef.current = { selected, checklist, founders, lawyerPackage };
    redrawRef.current?.();
    if (selected && prevSelectedRef.current !== selected) {
      setLanding(selected);
      const pad = structures[0];
      if (pad) burstRef.current?.(pad.x * WIDTH);
    }
    prevSelectedRef.current = selected;
    if (prevBuiltRef.current >= 0 && progress.built > prevBuiltRef.current) {
      const idx = structures.map((s, i) => (s.built ? i : -1)).filter((i) => i >= 0).pop() ?? -1;
      if (idx >= 0) burstRef.current?.(structures[idx].x * WIDTH);
    }
    prevBuiltRef.current = progress.built;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, checklist, founders, lawyerPackage]);

  // The landing toast is a moment, not a permanent label: clear it after
  // the pad has had time to build so it never contradicts a finished colony.
  useEffect(() => {
    if (!landing) return;
    const timer = setTimeout(() => setLanding(null), 3500);
    return () => clearTimeout(timer);
  }, [landing]);

  useEffect(() => {
    if (useFallback) return;
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    const lifecycle = createHeroLifecycle();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    (async () => {
      const { Application, Container, Graphics, Text, TextStyle } = await import("pixi.js");
      if (cancelled) return;
      const app = new Application();
      try {
        await app.init({ width: WIDTH, height: HEIGHT, backgroundAlpha: 0, antialias: true });
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
        "Colony board: structures appear as you approve each guided colony build step. " +
          "The crew quarters resize with the equity split, and the rocket launches when the lawyer summary is prepared.",
      );

      const scene = new Container();
      app.stage.addChild(scene);
      const groundY = HEIGHT - GROUND_H;

      const sky = new Graphics();
      scene.addChild(sky);
      const starPts = starfieldPoints(WIDTH, HEIGHT, 110, 4242);
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

      const ground = new Graphics();
      scene.addChild(ground);

      const labelStyle = new TextStyle({ fill: "#dbe4ff", fontSize: 11, fontFamily: "sans-serif" });
      const structureNodes = colonyStructures(stateRef.current.checklist).map((s) => {
        const node = new Container();
        node.x = s.x * WIDTH;
        node.y = groundY;
        const g = new Graphics();
        const label = new Text({ text: s.label, style: labelStyle });
        label.anchor.set(0.5, 0);
        label.y = 8;
        node.addChild(g, label);
        scene.addChild(node);
        return { node, g, label, kind: s.kind };
      });

      const rocket = new Graphics();
      rocket.visible = false;
      scene.addChild(rocket);
      const rocketBaseX = 0.1 * WIDTH;

      // Fixed burst pool, same pattern as the hero.
      let elapsedMs = 0;
      const burstPool = Array.from({ length: 4 }, () => {
        const g = new Graphics();
        g.visible = false;
        scene.addChild(g);
        return { g, start: -1, x: 0 };
      });
      let burstSlot = 0;
      burstRef.current = (x: number) => {
        if (reduced) return;
        const slot = burstPool[burstSlot % burstPool.length];
        burstSlot++;
        slot.start = elapsedMs;
        slot.x = x;
        slot.g.clear();
        slot.g.circle(0, 0, 16);
        slot.g.stroke({ color: 0xffd166, width: 3, alpha: 0.9 });
        slot.g.x = x;
        slot.g.y = groundY - 26;
        slot.g.visible = true;
      };

      const drawStructure = (g: InstanceType<typeof Graphics>, kind: string, built: boolean, st: typeof stateRef.current) => {
        const pal = colonyPalette(st.selected);
        const landed = kind === "landingPad" && Boolean(st.selected);
        const alpha = built || landed ? 1 : 0.22;
        g.clear();
        if (kind === "landingPad") {
          g.ellipse(0, 0, 52, 10);
          g.fill({ color: pal.accent, alpha: built || landed ? 0.9 : 0.25 });
          g.rect(-2, -34, 4, 34);
          g.fill({ color: 0xdbe4ff, alpha });
          g.poly([2, -34, 20, -29, 2, -24]);
          g.fill({ color: 0xff5a5a, alpha });
        } else if (kind === "dome") {
          g.arc(0, 0, 40, Math.PI, 0);
          g.fill({ color: 0x9fd8e8, alpha: built ? 0.55 : 0.18 });
          g.rect(-9, -16, 18, 16);
          g.fill({ color: 0x0b1026, alpha });
          g.circle(14, -24, 5);
          g.fill({ color: 0xffd166, alpha });
        } else if (kind === "crewQuarters") {
          const totalW = 148;
          let cx = -totalW / 2;
          crewQuarters(st.founders).forEach((q, i) => {
            const w = q.widthFraction * totalW;
            g.rect(cx, -38, Math.max(0, w - 2), 38);
            g.fill({ color: QUARTER_COLORS[i % QUARTER_COLORS.length], alpha: built ? 0.9 : 0.2 });
            cx += w;
          });
          g.rect(-totalW / 2, -44, totalW, 6);
          g.fill({ color: 0xdbe4ff, alpha });
        } else if (kind === "solarArray") {
          g.rect(-3, -30, 6, 30);
          g.fill({ color: 0xdbe4ff, alpha });
          for (let r = 0; r < 2; r++) {
            for (let c = 0; c < 3; c++) {
              g.rect(-36 + c * 25, -58 + r * 14, 22, 11);
              g.fill({ color: 0x2b6cb0, alpha });
              g.stroke({ color: pal.accent, width: 1, alpha });
            }
          }
        } else {
          // bagelFactory
          g.rect(-30, -42, 60, 42);
          g.fill({ color: 0xc98a4b, alpha });
          g.rect(16, -64, 12, 24);
          g.fill({ color: 0x8a5a2b, alpha });
          g.circle(0, -56, 13);
          g.stroke({ color: 0xe8b06a, width: 7, alpha });
          g.circle(-16, -14, 5);
          g.fill({ color: 0xffd166, alpha });
        }
      };

      const redraw = () => {
        const st = stateRef.current;
        const pal = colonyPalette(st.selected);
        sky.clear();
        sky.rect(0, 0, WIDTH, HEIGHT);
        sky.fill({ color: pal.sky, alpha: 1 });
        ground.clear();
        ground.rect(0, groundY, WIDTH, GROUND_H);
        ground.fill({ color: pal.ground, alpha: 0.4 });
        ground.rect(0, groundY, WIDTH, 3);
        ground.fill({ color: pal.accent, alpha: 0.9 });
        const structs = colonyStructures(st.checklist);
        structureNodes.forEach((entry, i) => {
          const s = structs[i];
          if (!s) return;
          entry.node.x = s.x * WIDTH;
          entry.label.text = s.built ? s.label : `${s.label} (not built)`;
          drawStructure(entry.g, s.kind, s.built, st);
        });
        const ls = launchState(st.checklist, st.lawyerPackage);
        rocket.visible = ls !== "idle";
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
            starNodes[i].x = s.x;
            starNodes[i].alpha = s.alpha * (0.65 + 0.35 * Math.sin(elapsedMs * s.twinkleSpeed + s.phase));
          }
          const st = stateRef.current;
          const ls = launchState(st.checklist, st.lawyerPackage);
          rocket.clear();
          if (ls !== "idle") {
            rocket.visible = true;
            const lift = ls === "launched" ? launchFrame(elapsedMs).lift : 0;
            const flicker = ls === "launched" ? 4 + Math.sin(elapsedMs * 0.04) * 2 : 2;
            const rx = rocketBaseX;
            const ry = groundY - lift;
            rocket.poly([rx - 11, ry, rx + 11, ry, rx, ry - 38]);
            rocket.fill({ color: 0xe6eaff, alpha: 1 });
            rocket.circle(rx, ry - 20, 4.5);
            rocket.fill({ color: 0x2b6cb0, alpha: 1 });
            rocket.poly([rx - 11, ry, rx - 19, ry + 10, rx - 4, ry + 2]);
            rocket.fill({ color: 0xff5a5a, alpha: 1 });
            rocket.poly([rx + 11, ry, rx + 19, ry + 10, rx + 4, ry + 2]);
            rocket.fill({ color: 0xff5a5a, alpha: 1 });
            rocket.poly([rx - 5, ry, rx + 5, ry, rx, ry + 10 + flicker]);
            rocket.fill({ color: 0xffd166, alpha: 0.95 });
          } else {
            rocket.visible = false;
          }
          for (const slot of burstPool) {
            if (slot.start < 0) continue;
            const frame = burstRing(16, elapsedMs - slot.start);
            if (!frame) {
              slot.start = -1;
              slot.g.visible = false;
            } else {
              const s = frame.radius / 16;
              slot.g.scale.set(s, s);
              slot.g.alpha = frame.alpha;
            }
          }
        });
      } else {
        // Static launched frame for reduced motion: rocket on the pad.
        redraw();
      }

      (host as unknown as { __colonyDestroy?: () => void }).__colonyDestroy = () =>
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
      const hostEl = host as unknown as { __colonyDestroy?: () => void };
      hostEl.__colonyDestroy?.();
      delete hostEl.__colonyDestroy;
      host.replaceChildren();
    };
    // Board is built once; shared state flows via refs + redraw.
  }, [useFallback]);

  return (
    <section aria-label="Colony board — your corporation takes shape" className="stage-scene colony-scene">
      <div className="stage-title-row">
        <h2 className="stage-title">Colony board</h2>
        <span className={`chip ${launch === "launched" ? "chip-live" : "chip-demo"}`}>
          {launch === "launched" ? "LAUNCHED" : launch === "ready" ? "READY ON PAD" : "LIVE BUILD"}
        </span>
      </div>
      <p className="stage-desc">
        {selected ? <>Home base: <strong>{selected}</strong>. </> : "Pick a home base, then "}
        each checklist tick raises a structure. Crew quarters resize with the equity split and the
        rocket launches when the lawyer package is prepared.
      </p>

      {useFallback ? (
        <div role="img" aria-label="Static colony board" className="colony-fallback">
          <div className="split-bar" aria-label="Crew quarters split">
            {quarters.map((q, i) => (
              <div
                key={q.name}
                className={`split-seg split-seg-${i % 5}`}
                style={{ width: `${q.widthFraction * 100}%` }}
              >
                {q.percent}%
              </div>
            ))}
          </div>
          <ul className="fallback-build-list">
            {structures.map((s) => (
              <li key={s.checklistId}>
                <span aria-hidden="true">{s.built ? "▰" : "▱"}</span>
                {s.built ? "Built: " : "Not built: "}
                {s.label}
              </li>
            ))}
          </ul>
          <p className="stage-status">LAUNCH · {launch}</p>
        </div>
      ) : (
        <div ref={hostRef} className="pixi-host colony-host" />
      )}

      <div className="colony-hud">
        <span>
          STRUCTURES <strong>{progress.built}/{progress.total}</strong>
        </span>
        <span>
          CREW{" "}
          {quarters.map((q) => `${q.name.replace("DEMO Founder ", "").replace(" (fictional)", "")} ${q.percent}%`).join(" / ")}
        </span>
        <span>
          LAUNCH <strong>{launch === "launched" ? "LAUNCHED" : launch === "ready" ? "READY" : "STANDBY"}</strong>
        </span>
      </div>
      <p data-testid="colony-progress" className="stage-status">
        Colony built: {progress.built} of {progress.total} structures ({progress.percent}%)
        {" · "}Launch: {launch === "launched" ? "launched" : launch === "ready" ? "ready on the pad" : "not ready"}
      </p>
      {landing ? (
        <p data-testid="colony-landing" data-selected={landing} className="landing-toast">
          Landing on {landing} — landing pad building
        </p>
      ) : null}
    </section>
  );
}

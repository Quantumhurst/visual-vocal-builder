"use client";

// Full-viewport starfield background behind the centered page column,
// so stars show in the left/right margins on wide screens. Reuses the
// seeded starfield pattern from lib/hero.ts (starfieldPoints): points
// are precomputed once per size, the frame loop only mutates x/alpha.
// It reads no shared state and writes none — pure backdrop.
// prefers-reduced-motion: stars are drawn once, static, no loop.

import { useEffect, useRef } from "react";
import { starfieldPoints } from "../lib/hero";

export default function StarfieldBackground() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let stars = starfieldPoints(window.innerWidth, window.innerHeight, 180, 2027);

    const size = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      stars = starfieldPoints(canvas.width, canvas.height, 180, 2027);
    };
    size();

    const draw = (elapsedMs: number) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const s of stars) {
        const twinkle = reduced ? 1 : 0.65 + 0.35 * Math.sin(elapsedMs * s.twinkleSpeed + s.phase);
        ctx.globalAlpha = Math.max(0, Math.min(1, s.alpha * twinkle));
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };

    if (reduced) {
      draw(0);
    } else {
      let last = performance.now();
      const tick = (now: number) => {
        const dt = Math.min(50, now - last) / 16.667; // ~60fps frames
        last = now;
        for (const s of stars) {
          s.x -= s.speed * dt;
          if (s.x < -s.r) s.x += canvas.width + s.r * 2;
        }
        draw(now);
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }

    const onResize = () => {
      size();
      if (reduced) draw(0);
    };
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      data-testid="starfield-background"
      style={{
        position: "fixed",
        inset: 0,
        width: "100vw",
        height: "100vh",
        zIndex: -1,
        pointerEvents: "none",
      }}
    />
  );
}

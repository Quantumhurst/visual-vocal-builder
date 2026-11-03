"use client";

// Persistent landing screen for the same `/` route.
//
// The old boot fallback only flashed while the cockpit bundle loaded.
// This is a real first screen: it stays until Enter the Bridge, then
// mounts the cockpit and hands the click to the existing first-Speak
// path (greeting once, then arm the mic). No new route.

import { useState } from "react";
import CanvasHost from "./Canvas";

export default function LandingGate() {
  const [entered, setEntered] = useState(false);

  if (entered) return <CanvasHost autoStart />;

  return (
    <main
      className="boot-screen landing-screen"
      aria-labelledby="landing-title"
      aria-describedby="landing-disclaimer"
    >
      <div className="landing-orb-wrap" aria-hidden="true">
        <span className="landing-spin" />
        <span className="boot-orbit" />
      </div>
      <p className="eyebrow">VVB-01 · ORBITAL FOUNDRY</p>
      <h1 id="landing-title">Visual Vocal Builder</h1>
      <p className="landing-tagline">Incorporate a company by voice</p>
      <p id="landing-disclaimer" className="landing-disclaimer">
        Demo data only. This is not legal advice, not a filing, and nothing here is
        submitted to any registry.
      </p>
      <button
        type="button"
        className="btn btn-primary landing-enter"
        data-testid="enter-bridge"
        onClick={() => setEntered(true)}
      >
        Enter the Bridge
      </button>
    </main>
  );
}

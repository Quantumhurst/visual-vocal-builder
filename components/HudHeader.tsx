"use client";

// Mission header: brand mark and the five required-mission pips.
// Presentation only; a pip click goes through the same selectModule path
// as the flight plan and the module tabs.

import { REQUIRED_BEATS, type Beat } from "../lib/beat-progress";
import { flightStatusLabel, moduleFor, type FlightStep } from "../lib/game-ui";

type Props = {
  doneCount: number;
  requiredTotal: number;
  flight: FlightStep[];
  activeModule: Beat;
  selectModule: (id: Beat) => void;
};

export default function HudHeader({ doneCount, requiredTotal, flight, activeModule, selectModule }: Props) {
  return (
    <header className="hud" aria-label="Mission header">
      <div className="brand">
        <span className="brand-orb-wrap" aria-hidden="true">
          <span className="brand-spin" />
          <span className="brand-mark">
            <span />
          </span>
        </span>
        <div className="brand-text">
          <p className="eyebrow">VVB-01 · ORBITAL FOUNDRY</p>
          <h1>Visual Vocal Builder</h1>
        </div>
      </div>

      <div className="hud-mission" aria-label={`${doneCount} of ${requiredTotal} missions complete`}>
        <span className="hud-kicker">{requiredTotal} MISSIONS</span>
        <div className="hud-pips" role="group" aria-label="Required missions">
          {REQUIRED_BEATS.map((beat) => {
            const step = flight.find((entry) => entry.id === beat);
            const meta = moduleFor(beat);
            return (
              <button
                key={beat}
                type="button"
                className={`hud-pip is-${step?.status ?? "pending"}`}
                data-testid={`hud-pip-${beat}`}
                aria-pressed={activeModule === beat}
                onClick={() => selectModule(beat)}
                title={`${meta.label} — ${step ? flightStatusLabel(step.status) : "PENDING"}`}
              >
                <span className={`pip is-${step?.status ?? "pending"}`} aria-hidden="true" />
                <span className="hud-pip-label">{meta.short}</span>
              </button>
            );
          })}
        </div>
        <strong className="hud-count">
          {doneCount}
          <span>/{requiredTotal}</span>
        </strong>
      </div>
    </header>
  );
}

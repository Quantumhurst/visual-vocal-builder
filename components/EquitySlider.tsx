"use client";

import type { FounderShare } from "../lib/equity";
import { totalPercent } from "../lib/equity";

type Props = {
  founders: FounderShare[];
  equityNote: string;
  // The ONE shared-state update path: slider drags call this, and the
  // voice-agent action calls the same function in Canvas. Both go
  // through setFounderShare(), so splits always total 100%.
  onShareChange: (index: number, percent: number) => void;
};

// Catalog entry vvb-equity-slider-v1 (lib/catalog.ts). Dragging a
// slider writes shared state directly — no new prompt needed — and
// the agent sees the new split on its next turn.
export default function EquitySlider({ founders, equityNote, onShareChange }: Props) {
  return (
    <section aria-label="Equity split">
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
        <h2>Equity split</h2>
        <span
          style={{
            border: "1px solid currentColor",
            borderRadius: "999px",
            padding: "0.1rem 0.6rem",
            fontSize: "0.8rem",
          }}
        >
          DEMO data — fictional founders
        </span>
      </div>
      <p>Drag a slider or say e.g. “make me 70%”. Splits always total 100%.</p>
      {founders.map((founder, index) => (
        <div key={founder.name} style={{ marginBottom: "0.75rem" }}>
          <label>
            {founder.name}: <strong>{founder.percent}%</strong>
            <br />
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={founder.percent}
              aria-label={`${founder.name} equity percent`}
              onChange={(event) =>
                onShareChange(index, Number(event.target.value))
              }
              style={{ width: "320px" }}
            />
          </label>
        </div>
      ))}
      <p>
        Total: <strong>{totalPercent(founders)}%</strong>
      </p>
      {equityNote ? <p>Agent note: {equityNote}</p> : null}
    </section>
  );
}

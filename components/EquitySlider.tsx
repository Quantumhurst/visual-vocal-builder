"use client";

import type { FounderShare } from "../lib/equity";
import { MAX_OWNERS, totalPercent } from "../lib/equity";

type Props = {
  founders: FounderShare[];
  equityNote: string;
  // The ONE shared-state update path: slider drags call this, and the
  // voice-agent action calls the same function in Canvas. Both go
  // through setFounderShare(), so splits always total 100%.
  onShareChange: (index: number, percent: number) => void;
  // 1–5 owners. Growing adds owners at 0%; shrinking redistributes the
  // removed share. The total stays 100%.
  onOwnerCountChange: (count: number) => void;
};

function displayName(name: string): string {
  return name.replace(/^DEMO Founder /, "").replace(/ \(fictional\)$/, "");
}

// Catalog entry vvb-equity-slider-v1 (lib/catalog.ts). Dragging a crew
// bar writes shared state directly — no new prompt needed — and the
// agent sees the new split on its next turn.
export default function EquitySlider({ founders, equityNote, onShareChange, onOwnerCountChange }: Props) {
  return (
    <section aria-label="Equity split" className="sys-section">
      <div className="section-head">
        <h2>Equity split</h2>
        <span className="chip chip-demo">DEMO FOUNDERS</span>
      </div>

      <div className="owner-count" role="group" aria-label="Number of owners">
        <span>OWNERS</span>
        {Array.from({ length: MAX_OWNERS }, (_, index) => index + 1).map((count) => (
          <button
            key={count}
            type="button"
            aria-pressed={founders.length === count}
            className={founders.length === count ? "is-active" : ""}
            onClick={() => onOwnerCountChange(count)}
          >
            {count}
          </button>
        ))}
      </div>

      <div className="split-bar" aria-hidden="true">
        {founders.map((founder, index) => (
          <span
            key={founder.name}
            className={`split-seg split-seg-${index % 5}`}
            style={{ width: `${founder.percent}%` }}
          >
            {founder.percent >= 14 ? `${founder.percent}%` : ""}
          </span>
        ))}
      </div>

      <p className="section-lede">
        Drag a crew bar or say “make me 70%”. Choose 1–5 owners; the split always totals 100%.
      </p>

      <div className="crew-list">
        {founders.map((founder, index) => (
          <div className="crew-row" key={founder.name} data-crew={index % 5}>
            <div className="crew-head">
              <label htmlFor={`equity-${index}`}>
                <span className="crew-dot" aria-hidden="true" />
                {displayName(founder.name)}
              </label>
              <strong>{founder.percent}%</strong>
            </div>
            <input
              id={`equity-${index}`}
              className="crew-range"
              type="range"
              min={0}
              max={100}
              step={1}
              value={founder.percent}
              aria-label={`${founder.name} equity percent`}
              onChange={(event) => onShareChange(index, Number(event.target.value))}
            />
          </div>
        ))}
      </div>

      <div className="total-line">
        <span>TOTAL ALLOCATED</span>
        <strong>{totalPercent(founders)}%</strong>
        <span className="chip chip-lock">LOCKED</span>
      </div>
      {equityNote ? <p className="hint-line">{equityNote}</p> : null}

      <div className="system-diag" aria-label="Equity system status">
        <div>
          <span>INVARIANT</span>
          <strong>SUM = {totalPercent(founders)}%</strong>
        </div>
        <div>
          <span>INPUTS</span>
          <strong>VOICE + SLIDER</strong>
        </div>
        <div>
          <span>AUTO-BALANCE</span>
          <strong>ON</strong>
        </div>
      </div>
    </section>
  );
}

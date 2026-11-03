"use client";

import type { JurisdictionRow } from "../lib/state";

type Props = {
  rows: JurisdictionRow[];
  selected: string | null;
  focus?: string | null;
  focusReason?: string;
  onSelect: (jurisdiction: string) => void;
};

// Catalog entry vvb-jurisdiction-table-v1 (lib/catalog.ts). The A2UI
// Basic Catalog has no Table, so beat 1 is this custom world-dossier
// list, driven by CopilotKit shared state like any catalog component.
// Card clicks write shared state directly (no new prompt).
// The DEMO highlight (focus) is separate from the selected card and
// never overrides the user's pick.
export default function JurisdictionTable({ rows, selected, focus, focusReason, onSelect }: Props) {
  return (
    <section aria-label="Jurisdiction comparison" className="sys-section">
      <div className="section-head">
        <h2>Jurisdiction comparison</h2>
        <span className="chip chip-demo">DEMO</span>
      </div>
      <p className="section-lede">Fictional worlds only — click a dossier or say a name.</p>

      <ul className="world-list">
        {rows.map((row) => {
          const isSelected = selected === row.jurisdiction;
          const isFocus = focus === row.jurisdiction;
          return (
            <li key={row.jurisdiction}>
              <button
                type="button"
                className={`world-card${isSelected ? " is-selected" : ""}${isFocus ? " is-focused" : ""}`}
                onClick={() => onSelect(row.jurisdiction)}
                aria-pressed={isSelected}
                data-focused={isFocus || undefined}
              >
                <span className="world-top">
                  <span className="world-name">{row.jurisdiction}</span>
                  {isSelected ? <span className="world-tag">SELECTED</span> : null}
                  {!isSelected && isFocus ? <span className="world-tag world-tag-focus">DEMO FOCUS</span> : null}
                </span>
                <span className="world-stats">
                  <span>
                    <em>FEE</em>
                    {row.filingFee}
                  </span>
                  <span>
                    <em>TIMELINE</em>
                    {row.timeline}
                  </span>
                </span>
                <span className="world-note">{row.directorNote}</span>
                <span className="world-why">{row.whyChoose}</span>
              </button>
            </li>
          );
        })}
      </ul>

      {focus ? (
        <p data-testid="jurisdiction-focus" className="hint-line">
          DEMO highlight: {focus}
          {focusReason ? ` — ${focusReason}` : ""}
        </p>
      ) : null}
      <p className="selection-line">
        {selected
          ? `Selected jurisdiction: ${selected}`
          : "No jurisdiction selected yet — speak, or click a world."}
      </p>
    </section>
  );
}

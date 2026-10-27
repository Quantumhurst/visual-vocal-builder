"use client";

import type { JurisdictionRow } from "../lib/state";

type Props = {
  rows: JurisdictionRow[];
  selected: string | null;
  onSelect: (jurisdiction: string) => void;
};

// Custom catalog component: the A2UI Basic Catalog has no Table, so beat 1
// renders as this component, driven by CopilotKit shared state like any
// catalog component. Row clicks write shared state directly (no new prompt).
export default function JurisdictionTable({ rows, selected, onSelect }: Props) {
  return (
    <section aria-label="Jurisdiction comparison">
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
        <h2>Jurisdiction comparison</h2>
        <span
          style={{
            border: "1px solid currentColor",
            borderRadius: "999px",
            padding: "0.1rem 0.6rem",
            fontSize: "0.8rem",
          }}
        >
          Demo data — fictional places
        </span>
      </div>
      <p>
        Demo data only — fictional places, not real jurisdictions. This is not
        legal advice, not a filing, and nothing here is submitted to any
        registry.
      </p>
      <table>
        <thead>
          <tr>
            <th>Jurisdiction</th>
            <th>Filing fee</th>
            <th>Typical timeline</th>
            <th>Director note</th>
            <th>Why choose it</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.jurisdiction}
              onClick={() => onSelect(row.jurisdiction)}
              aria-selected={selected === row.jurisdiction}
              style={{
                cursor: "pointer",
                background:
                  selected === row.jurisdiction ? "rgba(128,128,128,0.25)" : undefined,
              }}
            >
              <td>{row.jurisdiction}</td>
              <td>{row.filingFee}</td>
              <td>{row.timeline}</td>
              <td>{row.directorNote}</td>
              <td>{row.whyChoose}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {selected ? (
        <p>Selected jurisdiction: {selected}</p>
      ) : (
        <p>No jurisdiction selected yet — speak, or click a row.</p>
      )}
    </section>
  );
}

"use client";

import type { JurisdictionRow } from "../lib/state";

type Props = {
  rows: JurisdictionRow[];
  selected: string | null;
  focus?: string | null;
  focusReason?: string;
  onSelect: (jurisdiction: string) => void;
};

// Custom catalog component: the A2UI Basic Catalog has no Table, so beat 1
// renders as this component, driven by CopilotKit shared state like any
// catalog component. Row clicks write shared state directly (no new prompt).
// The DEMO highlight (focus) is separate from the selected-row styling and
// never overrides the user's pick.
export default function JurisdictionTable({ rows, selected, focus, focusReason, onSelect }: Props) {
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
          {rows.map((row) => {
            const isFocus = focus === row.jurisdiction;
            return (
              <tr
                key={row.jurisdiction}
                onClick={() => onSelect(row.jurisdiction)}
                aria-selected={selected === row.jurisdiction}
                data-focused={isFocus || undefined}
                style={{
                  cursor: "pointer",
                  background:
                    selected === row.jurisdiction ? "rgba(128,128,128,0.25)" : undefined,
                  outline: isFocus ? "2px dashed #f5b942" : undefined,
                  outlineOffset: isFocus ? "-2px" : undefined,
                }}
              >
                <td>{row.jurisdiction}</td>
                <td>{row.filingFee}</td>
                <td>{row.timeline}</td>
                <td>{row.directorNote}</td>
                <td>{row.whyChoose}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {focus ? (
        <p data-testid="jurisdiction-focus">
          DEMO highlight: {focus}
          {focusReason ? ` — ${focusReason}` : ""}
        </p>
      ) : null}
      {selected ? (
        <p>Selected jurisdiction: {selected}</p>
      ) : (
        <p>No jurisdiction selected yet — speak, or click a row.</p>
      )}
    </section>
  );
}

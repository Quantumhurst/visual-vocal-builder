"use client";

import type { ChecklistItem } from "../lib/state";

type Props = {
  items: ChecklistItem[];
  // One shared update path for voice (agent actions) and clicks.
  onToggle: (itemId: string, done: boolean) => void;
};

// Catalog entry vvb-filing-checklist-v1 (lib/catalog.ts). Content is
// guidance + grounded facts from the Corp Plan checklist pack only —
// never an actual registry filing, and there is no submission path.
export default function FilingChecklist({ items, onToggle }: Props) {
  const doneCount = items.filter((item) => item.done).length;
  return (
    <section aria-label="Filing checklist">
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
        <h2>Filing checklist (guidance only)</h2>
        <span
          style={{
            border: "1px solid currentColor",
            borderRadius: "999px",
            padding: "0.1rem 0.6rem",
            fontSize: "0.8rem",
          }}
        >
          DEMO — guidance only, not a filing
        </span>
      </div>
      <p>
        Demo data only. Guidance and grounded facts only — nothing here is
        submitted to any registry. Check items by click or by voice.
      </p>
      <p>
        {doneCount} of {items.length} done
      </p>
      <ul style={{ listStyle: "none", paddingLeft: 0 }}>
        {items.map((item) => (
          <li key={item.id} style={{ marginBottom: "0.75rem" }}>
            <label>
              <input
                type="checkbox"
                checked={item.done}
                onChange={(event) => onToggle(item.id, event.target.checked)}
              />{" "}
              <strong>{item.label}</strong>
            </label>
            <br />
            <span>{item.guidance}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

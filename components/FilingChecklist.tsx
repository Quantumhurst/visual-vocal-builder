"use client";

import type { ChecklistItem } from "../lib/state";

type Props = {
  items: ChecklistItem[];
  // One shared update path for voice (agent actions) and clicks.
  onToggle: (itemId: string, done: boolean) => void;
  // Day 5: verifier flags per item id, shown on the item itself.
  flags?: Record<string, string>;
};

// Catalog entry vvb-filing-checklist-v1 (lib/catalog.ts). Content is
// guidance + grounded facts from the Corp Plan checklist pack only —
// never an actual registry filing, and there is no submission path.
export default function FilingChecklist({ items, onToggle, flags }: Props) {
  const doneCount = items.filter((item) => item.done).length;
  const percent = items.length > 0 ? Math.round((doneCount / items.length) * 100) : 0;

  return (
    <section aria-label="Filing checklist" className="sys-section">
      <div className="section-head">
        <h2>Build queue</h2>
        <span className="chip chip-demo">GUIDANCE ONLY</span>
      </div>
      <p className="section-lede">
        Every tick raises a structure on the colony board. No registry is contacted.
      </p>

      <div className="build-meter" aria-hidden="true">
        <span style={{ width: `${percent}%` }} />
      </div>
      <p className="build-count">
        <strong>{doneCount}</strong> / {items.length} structures online
      </p>

      <ul className="build-list">
        {items.map((item, index) => (
          <li key={item.id} className={item.done ? "is-built" : ""}>
            <label className="build-item">
              <input
                type="checkbox"
                checked={item.done}
                onChange={(event) => onToggle(item.id, event.target.checked)}
              />
              <span className="build-check" aria-hidden="true">
                {item.done ? "✓" : String(index + 1).padStart(2, "0")}
              </span>
              <span className="build-body">
                <strong>{item.label}</strong>
                <span>{item.guidance}</span>
              </span>
            </label>
            {flags?.[item.id] ? (
              <p className="flag-box" data-testid={`checklist-flag-${item.id}`}>
                <strong>FLAGGED</strong> — verifier: {flags[item.id]}. Shown
                as painted; never silently dropped or rewritten.
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

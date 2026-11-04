"use client";

// Compact build-queue picker for the left objective panel.
//
// The build mission is the one required task where the user must choose
// among five steps, so the options and the running 0/5..5/5 count stay
// visible next to the spoken question. Clicks use the same
// updateChecklistItem path as the full BUILD panel and the agent actions;
// this component owns presentation only.

import type { ChecklistItem } from "../lib/state";

type Props = {
  items: ChecklistItem[];
  built: number;
  total: number;
  percent: number;
  nextItemId: string | null;
  onToggle: (itemId: string, done: boolean) => void;
};

export default function BuildQueuePanel({
  items,
  built,
  total,
  percent,
  nextItemId,
  onToggle,
}: Props) {
  return (
    <section className="objective-build" data-testid="objective-build" aria-label="Build queue options">
      <div className="objective-build-head">
        <span className="eyebrow">BUILD QUEUE</span>
        <strong>
          {built}/{total}
        </strong>
      </div>
      <div className="build-meter" aria-hidden="true">
        <span style={{ width: `${percent}%` }} />
      </div>
      <ol className="objective-build-list">
        {items.map((item, index) => {
          const next = item.id === nextItemId;
          return (
            <li key={item.id}>
              <button
                type="button"
                className={`objective-build-step${item.done ? " is-done" : ""}${next ? " is-next" : ""}`}
                data-testid={`build-step-${item.id}`}
                aria-pressed={item.done}
                onClick={() => onToggle(item.id, !item.done)}
              >
                <span className="objective-build-check" aria-hidden="true">
                  {item.done ? "✓" : String(index + 1)}
                </span>
                <span className="objective-build-label">{item.label}</span>
                <span className="objective-build-status">
                  {item.done
                    ? "DONE"
                    : next
                      ? `NEXT · ${index + 1}/${total}`
                      : `${index + 1}/${total}`}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <p className="objective-build-hint">
        Click a step, or say “yes” to raise the highlighted structure.
      </p>
    </section>
  );
}

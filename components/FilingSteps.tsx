"use client";

import type { FilingStepsCard } from "../lib/state";

type Props = {
  card: FilingStepsCard;
  filingStepsNote: string;
};

// Catalog entry vvb-filing-steps-v1 (lib/catalog.ts), Day 3. Renders
// ONLY facts looked up in the Corp Plan filing-steps/fees pack, and
// shows grounding (pack id + fact ids) on the card. An ungrounded
// answer is never rendered as a card.
export default function FilingSteps({ card, filingStepsNote }: Props) {
  return (
    <section aria-label="Filing steps and fees">
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
        <h2>Filing steps &amp; fees (grounded)</h2>
        <span
          style={{
            border: "1px solid currentColor",
            borderRadius: "999px",
            padding: "0.1rem 0.6rem",
            fontSize: "0.8rem",
          }}
        >
          DEMO — grounded facts, not legal advice
        </span>
      </div>
      {card ? (
        <article
          style={{
            border: "1px solid currentColor",
            borderRadius: "8px",
            padding: "1rem",
          }}
        >
          <p>
            <strong>Question:</strong> {card.question}
          </p>
          {card.facts.map((fact) => (
            <div key={fact.factId} style={{ marginBottom: "0.75rem" }}>
              <p>
                <strong>{fact.topic}</strong> (<code>{fact.factId}</code>)
              </p>
              <p>{fact.text}</p>
            </div>
          ))}
          <p>
            Grounding: pack <code>{card.packId}</code> ({card.packTitle})
          </p>
          <p>
            Demo data only. This is not legal advice, not a filing, and
            nothing here is submitted to any registry.
          </p>
        </article>
      ) : (
        <p>
          Ask by voice, e.g. “What are the filing steps and fees?” The
          answer appears here only when it is grounded in the
          filing-steps/fees knowledge pack.
        </p>
      )}
      {filingStepsNote ? <p>{filingStepsNote}</p> : null}
    </section>
  );
}

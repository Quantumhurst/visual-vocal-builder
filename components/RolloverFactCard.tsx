"use client";

import type { RolloverCard } from "../lib/state";

type Props = {
  card: RolloverCard;
  rolloverNote: string;
  // Day 5: verifier flag for this card, shown on the card itself.
  flagReason?: string | null;
};

// Catalog entry vvb-rollover-fact-card-v1 (lib/catalog.ts). The card
// renders ONLY a fact looked up in the Corp Plan s.85 knowledge pack,
// and shows its grounding (pack id + fact id) on the card. An
// ungrounded answer is never rendered as a card.
export default function RolloverFactCard({ card, rolloverNote, flagReason }: Props) {
  return (
    <section aria-label="Section 85 rollover fact card">
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
        <h2>s.85 rollover fact card</h2>
        <span
          style={{
            border: "1px solid currentColor",
            borderRadius: "999px",
            padding: "0.1rem 0.6rem",
            fontSize: "0.8rem",
          }}
        >
          DEMO — grounded fact, not legal advice
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
          <p>{card.answer}</p>
          <p>
            Grounding: pack <code>{card.packId}</code> ({card.packTitle}),
            fact <code>{card.factId}</code>
          </p>
          <p>
            Demo data only. This is not legal advice, not a filing, and
            nothing here is submitted to any registry.
          </p>
          {flagReason ? (
            <p data-testid="rollover-flag">
              <strong>FLAGGED</strong> — verifier: {flagReason}. Shown as
              painted; never silently dropped or rewritten.
            </p>
          ) : null}
        </article>
      ) : (
        <p>
          Ask a rollover question by voice, e.g. “What is a section 85
          rollover?” The answer appears here only when it is grounded in
          the knowledge pack.
        </p>
      )}
      {rolloverNote ? <p>{rolloverNote}</p> : null}
    </section>
  );
}

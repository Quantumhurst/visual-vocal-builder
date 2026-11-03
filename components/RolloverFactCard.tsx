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
    <section aria-label="Section 85 rollover fact card" className="sys-section">
      <div className="section-head">
        <h2>s.85 rollover</h2>
        <span className="chip chip-demo">GROUNDED</span>
      </div>
      <p className="section-lede">
        Verbatim pack facts only. If the archive has no matching fact, no card appears.
      </p>

      {card ? (
        <article className="data-slate">
          <p className="slate-question">
            <span>QUERY</span>
            {card.question}
          </p>
          <p className="slate-text slate-answer">{card.answer}</p>
          <p className="grounding">
            <span>GROUNDING</span>
            pack <code>{card.packId}</code> · fact <code>{card.factId}</code>
            <br />
            {card.packTitle}
          </p>
          {flagReason ? (
            <p className="flag-box" data-testid="rollover-flag">
              <strong>FLAGGED</strong> — verifier: {flagReason}. Shown as
              painted; never silently dropped or rewritten.
            </p>
          ) : null}
        </article>
      ) : (
        <div className="empty-slate">
          <span className="empty-glyph" aria-hidden="true">
            ◇
          </span>
          <p>
            Ask a rollover question by voice, e.g. “What is a section 85 rollover?” The
            answer appears here only when it is grounded in the knowledge pack.
          </p>
        </div>
      )}
      {rolloverNote ? <p className="hint-line">{rolloverNote}</p> : null}
    </section>
  );
}

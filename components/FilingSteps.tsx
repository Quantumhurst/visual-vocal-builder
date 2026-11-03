"use client";

import type { FilingStepsCard } from "../lib/state";

type Props = {
  card: FilingStepsCard;
  filingStepsNote: string;
  // Day 5: verifier flag for this card, shown on the card itself.
  flagReason?: string | null;
};

// Catalog entry vvb-filing-steps-v1 (lib/catalog.ts), Day 3. Renders
// ONLY facts looked up in the Corp Plan filing-steps/fees pack, and
// shows grounding (pack id + fact ids) on the card. An ungrounded
// answer is never rendered as a card.
export default function FilingSteps({ card, filingStepsNote, flagReason }: Props) {
  return (
    <section aria-label="Filing steps and fees" className="sys-section">
      <div className="section-head">
        <h2>Filing steps &amp; fees</h2>
        <span className="chip chip-demo">GROUNDED</span>
      </div>
      <p className="section-lede">
        Answers here come only from the filing-steps/fees knowledge pack — never from the host’s prose.
      </p>

      {card ? (
        <article className="data-slate">
          <p className="slate-question">
            <span>QUERY</span>
            {card.question}
          </p>
          {card.facts.map((fact) => (
            <div key={fact.factId} className="slate-fact">
              <p className="slate-topic">
                {fact.topic} <code>{fact.factId}</code>
              </p>
              <p className="slate-text">{fact.text}</p>
            </div>
          ))}
          <p className="grounding">
            <span>GROUNDING</span>
            pack <code>{card.packId}</code> · {card.packTitle}
          </p>
          {flagReason ? (
            <p className="flag-box" data-testid="filing-steps-flag">
              <strong>FLAGGED</strong> — verifier: {flagReason}. Shown as
              painted; never silently dropped or rewritten.
            </p>
          ) : null}
        </article>
      ) : (
        <div className="empty-slate">
          <span className="empty-glyph" aria-hidden="true">
            ▥
          </span>
          <p>
            Ask by voice, e.g. “What are the filing steps and fees?” The answer appears
            here only when it is grounded in the filing-steps/fees knowledge pack.
          </p>
        </div>
      )}
      {filingStepsNote ? <p className="hint-line">{filingStepsNote}</p> : null}
    </section>
  );
}

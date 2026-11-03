"use client";

import type { VerifyResult } from "../lib/verifier";

// Day 5 trust strip — a display of the verifier's output
// (lib/verifier.ts), not a second verifier. It renders live from the
// shared-state check on every render, so it updates as cards paint.
// The talking agent never grades its own work: these verdicts come
// from the separate check against the knowledge packs.
//
// In the bridge UI this is a collapsible ship-systems readout, not a
// wall of cards in the middle of the story: counts stay visible and
// the per-card detail opens on demand.

type Props = {
  result: VerifyResult;
};

export default function TrustStrip({ result }: Props) {
  const { counts, verdicts, demoItems } = result;
  const clean = counts.flagged === 0;

  return (
    <details className="integrity" data-testid="trust-strip">
      <summary className="integrity-summary">
        <span className={`integrity-dot${clean ? " is-clean" : " is-flagged"}`} aria-hidden="true" />
        <span className="integrity-title">Integrity scan</span>
        <span className="integrity-counts">
          {counts.grounded} grounded · {counts.flagged} flagged · {counts.demo} demo
        </span>
        <span className="integrity-chevron" aria-hidden="true">
          ⌄
        </span>
      </summary>
      <div className="integrity-body">
        <p className="integrity-note">Checked against knowledge packs, never against the agent.</p>
        {verdicts.length === 0 ? (
          <p className="hint-line">No grounded cards painted yet — nothing to verify.</p>
        ) : (
          <ul className="verdict-list">
            {verdicts.map((verdict) => (
              <li
                key={`${verdict.cardKind}-${verdict.cardId}`}
                data-testid={`trust-verdict-${verdict.cardId}`}
                data-status={verdict.status}
                className="integrity-verdict"
              >
                <span className="verdict-state" aria-hidden="true">
                  {verdict.status === "grounded" ? "✓" : "!"}
                </span>
                <span>
                  <strong>{verdict.label}</strong>
                  <br />
                  {verdict.status === "grounded" ? "grounded" : <><strong>FLAGGED</strong> ({verdict.reason})</>}
                  <br />
                  <span className="verdict-detail">{verdict.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
        {demoItems.length > 0 ? (
          <p data-testid="trust-demo" className="integrity-demo">
            DEMO demo-data (never flagged): {demoItems.map((item) => item.jurisdiction).join(", ")}
          </p>
        ) : null}
      </div>
    </details>
  );
}

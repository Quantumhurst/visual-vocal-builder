"use client";

import type { VerifyResult } from "../lib/verifier";

// Day 5 trust strip — a display of the verifier's output
// (lib/verifier.ts), not a second verifier. It renders live from the
// shared-state check on every render, so it updates as cards paint.
// The talking agent never grades its own work: these verdicts come
// from the separate check against the knowledge packs.

type Props = {
  result: VerifyResult;
};

const badge = {
  border: "1px solid currentColor",
  borderRadius: "999px",
  padding: "0.1rem 0.6rem",
  fontSize: "0.8rem",
} as const;

export default function TrustStrip({ result }: Props) {
  const { counts, verdicts, demoItems } = result;
  return (
    <section aria-label="Verification trust strip" data-testid="trust-strip">
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
        <h2>Verification (separate check)</h2>
        <span style={badge}>checked against knowledge packs, not the agent</span>
      </div>
      <p data-testid="trust-counts">
        emitted: {counts.emitted} · rendered: {counts.rendered} · grounded:{" "}
        {counts.grounded} · flagged: {counts.flagged} · DEMO: {counts.demo}
      </p>
      {verdicts.length === 0 ? (
        <p>No grounded cards painted yet — nothing to verify.</p>
      ) : (
        <ul style={{ listStyle: "none", paddingLeft: 0 }}>
          {verdicts.map((verdict) => (
            <li
              key={`${verdict.cardKind}-${verdict.cardId}`}
              data-testid={`trust-verdict-${verdict.cardId}`}
              data-status={verdict.status}
              style={{ marginBottom: "0.5rem" }}
            >
              <strong>{verdict.label}</strong> — emitted ✓ · rendered ✓ ·{" "}
              {verdict.status === "grounded" ? (
                <span>grounded ✓</span>
              ) : (
                <span>
                  <strong>FLAGGED</strong> ({verdict.reason})
                </span>
              )}
              <br />
              <span>{verdict.detail}</span>
            </li>
          ))}
        </ul>
      )}
      {demoItems.length > 0 ? (
        <p data-testid="trust-demo">
          DEMO demo-data (not knowledge-pack facts, never flagged):{" "}
          {demoItems.map((item) => item.jurisdiction).join(", ")} — DEMO
        </p>
      ) : null}
    </section>
  );
}

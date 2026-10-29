"use client";

import { useState } from "react";
import type { SharedState } from "../lib/state";
import { buildLawyerSummary } from "../lib/lawyer-summary";

export { buildLawyerSummary };

type Props = {
  view: SharedState;
  companyName: string;
  lawyerPackage: string;
  lawyerNote: string;
  onPrepare: () => void;
};

// Catalog entry vvb-lawyer-summary-v1 (lib/catalog.ts), Day 3. Renders
// beat 5's prepared package from CopilotKit shared state (stateSlice
// lawyerPackage), whether the user clicked Prepare or the agent ran
// prepareLawyerSummary. PREP only: no send path in this code, not even
// a disabled one — only copy-to-clipboard and local download.
export default function LawyerSummary({
  lawyerPackage,
  lawyerNote,
  onPrepare,
}: Props) {
  const [notice, setNotice] = useState("");
  const prepared = lawyerPackage;

  async function copyPrepared() {
    try {
      await navigator.clipboard.writeText(prepared);
      setNotice("Copied. Forward it yourself — this app does not send email.");
    } catch {
      setNotice("Copy failed — select the text and copy it manually.");
    }
  }

  function downloadPrepared() {
    const blob = new Blob([prepared], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "lawyer-summary.txt";
    link.click();
    URL.revokeObjectURL(url);
    setNotice("Downloaded. Forward it yourself — this app does not send email.");
  }

  return (
    <section aria-label="Lawyer summary">
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
        <h2>Send to a lawyer for a second opinion</h2>
        <span
          style={{
            border: "1px solid currentColor",
            borderRadius: "999px",
            padding: "0.1rem 0.6rem",
            fontSize: "0.8rem",
          }}
        >
          DEMO data — package display, no send
        </span>
      </div>
      <p>
        Demo data only. This prepares a summary package of the session
        (jurisdiction choice, equity split, checklist state) for you to
        forward yourself. This app does not send email.
      </p>
      <button onClick={onPrepare}>Prepare lawyer summary</button>{" "}
      {prepared ? (
        <>
          <button onClick={copyPrepared}>Copy summary</button>{" "}
          <button onClick={downloadPrepared}>Download summary (.txt)</button>
        </>
      ) : null}
      {lawyerNote ? <p>{lawyerNote}</p> : null}
      {notice ? <p>{notice}</p> : null}
      {prepared ? (
        <pre
          style={{
            whiteSpace: "pre-wrap",
            border: "1px solid currentColor",
            borderRadius: "8px",
            padding: "1rem",
          }}
        >
          {prepared}
        </pre>
      ) : null}
    </section>
  );
}

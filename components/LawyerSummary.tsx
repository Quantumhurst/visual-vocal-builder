"use client";

import { useState } from "react";
import type { SharedState } from "../lib/state";
import { buildLawyerSummary } from "../lib/lawyer-summary";
import { summaryFilenameFor } from "../lib/downloads";

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
  companyName,
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
    const filename = summaryFilenameFor(companyName);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
    setNotice(`Downloaded ${filename}. Forward it yourself — this app does not send email.`);
  }

  return (
    <section aria-label="Lawyer summary" className="sys-section">
      <div className="section-head">
        <h2>Launch package</h2>
        <span className={`chip ${prepared ? "chip-live" : "chip-demo"}`}>
          {prepared ? "PACKAGE READY" : "NOT PREPARED"}
        </span>
      </div>
      <p className="section-lede">
        Builds a summary for you to forward yourself. Prep only — there is no send path.
      </p>

      <div className={`launch-pad${prepared ? " is-ready" : ""}`}>
        <span className="launch-orbit" aria-hidden="true" />
        <span className="launch-core" aria-hidden="true">
          ▲
        </span>
        <span className="launch-copy">
          <strong>{prepared ? "CLEARED FOR HANDOFF" : "AWAITING PACKAGE"}</strong>
          <span>
            {prepared
              ? "Copy or download the package, then forward it yourself."
              : "Prepare the package to fill the launch bay."}
          </span>
        </span>
      </div>

      <div className="button-row">
        <button type="button" className="btn btn-primary" onClick={onPrepare}>
          {prepared ? "Rebuild lawyer summary" : "Prepare lawyer summary"}
        </button>
        {prepared ? (
          <>
            <button type="button" className="btn" onClick={copyPrepared}>
              Copy summary
            </button>
            <button type="button" className="btn" onClick={downloadPrepared}>
              Download summary (.txt)
            </button>
          </>
        ) : null}
      </div>
      {lawyerNote ? <p className="hint-line">{lawyerNote}</p> : null}
      {notice ? (
        <p className="hint-line" role="status">
          {notice}
        </p>
      ) : null}
      {prepared ? <pre className="package">{prepared}</pre> : null}
    </section>
  );
}

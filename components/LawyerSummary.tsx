"use client";

import { useState } from "react";
import type { SharedState } from "../lib/state";

type Props = {
  view: SharedState;
  companyName: string;
};

// Step 5 — lawyer-summary PREP only. This prepares a summary package
// of the session for the user to forward themselves. It does NOT send
// email: there is no send path in this code, not even a disabled one —
// only copy-to-clipboard and download of a local text file.
export function buildLawyerSummary(view: SharedState, companyName: string): string {
  const equityLines = view.founders
    .map((founder) => `- ${founder.name}: ${founder.percent}%`)
    .join("\n");
  const checklistLines = view.checklist
    .map((item) => `- [${item.done ? "x" : " "}] ${item.label}`)
    .join("\n");
  return [
    "Visual Vocal Builder — session summary for a lawyer (second opinion)",
    "Demo data only. This is not legal advice, not a filing, and nothing here is submitted to any registry.",
    "",
    `Company (fictional demo): ${companyName}`,
    `Jurisdiction choice: ${view.selectedJurisdiction ?? "(none selected yet)"}`,
    "",
    "Equity split (DEMO):",
    equityLines || "- (no founders yet)",
    view.equityNote ? `Agent note: ${view.equityNote}` : "",
    "",
    "Checklist state:",
    checklistLines || "- (no checklist items yet)",
    "",
    view.rolloverCard
      ? `Rollover fact reviewed: ${view.rolloverCard.packId} / ${view.rolloverCard.factId}`
      : "Rollover fact reviewed: (none)",
    "",
    "Prepared for the user to forward themselves. This app does not send email.",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

export default function LawyerSummary({ view, companyName }: Props) {
  const [prepared, setPrepared] = useState("");
  const [notice, setNotice] = useState("");

  function prepare() {
    setPrepared(buildLawyerSummary(view, companyName));
    setNotice("Summary prepared. Copy or download it and forward it yourself — this app does not send email.");
  }

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
      <h2>Send to a lawyer for a second opinion</h2>
      <p>
        Demo data only. This prepares a summary package of the session
        (jurisdiction choice, equity split, checklist state) for you to
        forward yourself. This app does not send email.
      </p>
      <button onClick={prepare}>Prepare lawyer summary</button>{" "}
      {prepared ? (
        <>
          <button onClick={copyPrepared}>Copy summary</button>{" "}
          <button onClick={downloadPrepared}>Download summary (.txt)</button>
        </>
      ) : null}
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

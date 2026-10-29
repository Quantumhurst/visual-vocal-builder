// Lawyer-summary package builder — written in-window for Day 3 (Step 1).
// Pure function over shared state so the package the canvas displays,
// the text the user copies/downloads, and the tests all see the same
// package. PREP only: this module has no send path of any kind.

import type { SharedState } from "./state";

export function buildLawyerSummary(
  view: SharedState,
  companyName: string,
): string {
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
    view.filingStepsCard
      ? `Filing steps/fees reviewed: ${view.filingStepsCard.packId} / ${view.filingStepsCard.facts.map((fact) => fact.factId).join(", ")}`
      : "Filing steps/fees reviewed: (none)",
    "",
    "Prepared for the user to forward themselves. This app does not send email.",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

import type { SharedState } from "./state.ts";

function shortName(name: string): string {
  return name.replace(/^DEMO Founder\s+/i, "").replace(/\s*\(fictional\)\s*$/i, "");
}

export function currentStateSummary(s: SharedState): string {
  const place = s.selectedJurisdiction ?? "no home base";
  const equity = s.founders.map((f) => `${shortName(f.name)} ${f.percent}%`).join(" / ");
  const done = s.checklist.filter((i) => i.done).length;
  return `${place} · ${equity} · ${done} of ${s.checklist.length} done`;
}

// Builds the tool result from the real diff, never from intent.
export function describeChange(before: SharedState, after: SharedState): string {
  const parts: string[] = [];

  if (before.selectedJurisdiction !== after.selectedJurisdiction) {
    parts.push(
      `Home base: ${before.selectedJurisdiction ?? "none"} → ${after.selectedJurisdiction ?? "none"}.`,
    );
  }

  const equityChanged = before.founders.some(
    (f, i) => f.percent !== after.founders[i]?.percent || f.name !== after.founders[i]?.name,
  );
  if (equityChanged) {
    const seg = after.founders
      .map((f, i) => `${shortName(f.name)} ${before.founders[i]?.percent ?? "?"}%→${f.percent}%`)
      .join(", ");
    const total = after.founders.reduce((a, f) => a + f.percent, 0);
    parts.push(`Equity: ${seg} (total ${total}%).`);
  } else if (before.equityNote !== after.equityNote && after.equityNote) {
    parts.push(`Equity note: ${after.equityNote}`);
  }

  if (before.companyName !== after.companyName) {
    parts.push(
      after.companyName
        ? `Company name approved: ${after.companyName}.`
        : "Company name approval cleared.",
    );
  }

  const ticked: string[] = [];
  const unticked: string[] = [];
  after.checklist.forEach((item, i) => {
    const was = before.checklist[i]?.done;
    if (item.done && !was) {
      ticked.push(item.label);
    }
    if (!item.done && was) unticked.push(item.label);
  });
  const doneCount = after.checklist.filter((i) => i.done).length;
  if (ticked.length) {
    parts.push(
      `Ticked: ${ticked.join(", ")}. Checklist now ${doneCount} of ${after.checklist.length} done.`,
    );
  }
  if (unticked.length) {
    parts.push(
      `Unticked: ${unticked.join(", ")}. Checklist now ${doneCount} of ${after.checklist.length} done.`,
    );
  }

  if (JSON.stringify(before.rolloverCard) !== JSON.stringify(after.rolloverCard)) {
    parts.push(
      after.rolloverCard
        ? `Shown s.85 card ${after.rolloverCard.factId}.`
        : "Rollover card cleared (no grounded fact).",
    );
  }
  if (JSON.stringify(before.filingStepsCard) !== JSON.stringify(after.filingStepsCard)) {
    parts.push(
      after.filingStepsCard
        ? `Shown filing-steps card ${after.filingStepsCard.facts.map((f) => f.factId).join(", ")}.`
        : "Filing-steps card cleared (no grounded fact).",
    );
  }
  if (!before.lawyerPackage && after.lawyerPackage) {
    parts.push("Lawyer summary prepared (not sent).");
  } else if (before.lawyerPackage && !after.lawyerPackage) {
    parts.push("Lawyer summary cleared.");
  }

  if (before.focusJurisdiction !== after.focusJurisdiction || before.focusReason !== after.focusReason) {
    parts.push(
      after.focusJurisdiction
        ? `DEMO highlight: ${after.focusJurisdiction} (${after.focusReason || "comparison"}). Selection unchanged: ${after.selectedJurisdiction ?? "none"}.`
        : "DEMO highlight cleared.",
    );
  }

  const reset =
    after.selectedJurisdiction === null &&
    before.selectedJurisdiction !== null &&
    doneCount === 0 &&
    !after.companyName &&
    !after.lawyerPackage;
  if (parts.length === 0) {
    return `Confirmed: the canvas already matches that request, so it is done. Current state: ${currentStateSummary(after)}.`;
  }
  if (reset && ticked.length === 0 && parts.length > 1) {
    return `Canvas reset. ${parts.join(" ")} Current state: ${currentStateSummary(after)}.`;
  }
  return parts.join(" ");
}

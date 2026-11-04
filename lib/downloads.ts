// Voice download files — pure, unit-testable.
//
// Download names are built from the company, and both files carry the
// demo / not-a-filing disclaimer inside the file itself.

import { DEMO_COMPANY_NAME } from "./demo-data.ts";
import type { SharedState } from "./state.ts";
import type { TranscriptEntry } from "./persistence.ts";

export const FILE_DISCLAIMER =
  "Demo only. This is not legal advice, not a filing, and nothing here is submitted to any registry. No email is sent.";

export function companyFileSlug(name?: string | null): string {
  const base = (name ?? "").trim() || DEMO_COMPANY_NAME;
  const slug = base
    .replace(/\(fictional\)/gi, " ")
    .replace(/\b(?:inc|ltd|corp|co|llc)\b\.?/gi, " ")
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, " ")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "galactic-bagels";
}

export function summaryFilenameFor(companyName?: string | null): string {
  return `${companyFileSlug(companyName)}-summary.txt`;
}

export function summaryFilename(state: Pick<SharedState, "companyName">): string {
  return summaryFilenameFor(state.companyName);
}

export function transcriptFilenameFor(companyName?: string | null): string {
  return `${companyFileSlug(companyName)}-transcript.txt`;
}

export function transcriptFilename(state: Pick<SharedState, "companyName">): string {
  return transcriptFilenameFor(state.companyName);
}

export function packageFilenameFor(companyName?: string | null): string {
  return `${companyFileSlug(companyName)}-demo-package.txt`;
}

export function packageFilename(state: Pick<SharedState, "companyName">): string {
  return packageFilenameFor(state.companyName);
}

export function hasTranscriptContent(entries: readonly TranscriptEntry[]): boolean {
  return entries.some((entry) => entry.text.trim().length > 0);
}

export function buildPackageFile(
  entries: readonly TranscriptEntry[],
  state: Pick<SharedState, "companyName" | "lawyerPackage">,
): string {
  const company = (state.companyName ?? "").trim() || DEMO_COMPANY_NAME;
  const summary = (state.lawyerPackage ?? "").trim() || "(No lawyer summary was prepared.)";
  const transcript = entries.map(
    (entry) => `${entry.role === "you" ? "HEARD" : "HOST"}: ${entry.text.trim()}`,
  );
  return [
    `Visual Vocal Builder — demo package for ${company}`,
    FILE_DISCLAIMER,
    "",
    "===== LAWYER SUMMARY =====",
    summary,
    "",
    "===== FULL TRANSCRIPT =====",
    ...(transcript.length > 0 ? transcript : ["(No transcript entries.)"]),
    "",
    "End of demo package.",
    FILE_DISCLAIMER,
  ].join("\n");
}

export function buildTranscriptFile(
  entries: readonly TranscriptEntry[],
  state: Pick<SharedState, "companyName">,
): string {
  const company = (state.companyName ?? "").trim() || DEMO_COMPANY_NAME;
  const lines = entries.map(
    (entry) => `${entry.role === "you" ? "HEARD" : "HOST"}: ${entry.text.trim()}`,
  );
  return [
    `Visual Vocal Builder — demo transcript for ${company}`,
    FILE_DISCLAIMER,
    "",
    ...lines,
    "",
    "End of demo transcript.",
    FILE_DISCLAIMER,
  ].join("\n");
}

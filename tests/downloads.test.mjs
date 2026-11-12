import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FILE_DISCLAIMER,
  buildPackageFile,
  buildTranscriptFile,
  companyFileSlug,
  hasTranscriptContent,
  packageFilename,
  packageFilenameFor,
  summaryFilename,
  summaryFilenameFor,
  transcriptFilename,
  transcriptFilenameFor,
} from "../lib/downloads.ts";

const company = { companyName: "Galactic Bagels Inc. (fictional)" };
const prepared = {
  ...company,
  lawyerPackage: "Galactic Bagels Inc. (fictional) — Mars — 40% / 20% / 20% / 20%\nDemo data only. This is not legal advice, not a filing.",
};

test("file names are built from the company", () => {
  assert.equal(companyFileSlug("Galactic Bagels Inc. (fictional)"), "galactic-bagels");
  assert.equal(companyFileSlug("Cosmic Donuts (fictional)"), "cosmic-donuts");
  assert.equal(companyFileSlug(""), "galactic-bagels");
  assert.equal(companyFileSlug("!!!"), "galactic-bagels");
  assert.equal(summaryFilename(company), "galactic-bagels-summary.txt");
  assert.equal(transcriptFilename(company), "galactic-bagels-transcript.txt");
  assert.equal(summaryFilenameFor("Acme Rockets (fictional)"), "acme-rockets-summary.txt");
  assert.equal(transcriptFilenameFor("Acme Rockets (fictional)"), "acme-rockets-transcript.txt");
  assert.equal(packageFilename(company), "galactic-bagels-demo-package.txt");
  assert.equal(packageFilenameFor("Acme Rockets (fictional)"), "acme-rockets-demo-package.txt");
});

test("transcript file contains the dialogue and the disclaimer inside the file", () => {
  const entries = [
    { role: "you", text: "Approve Galactic Bagels", at: 1 },
    { role: "host", text: "Commander — Company name approved.", at: 2 },
  ];
  assert.equal(hasTranscriptContent(entries), true);
  const text = buildTranscriptFile(entries, company);
  assert.match(text, /demo transcript for Galactic Bagels/);
  assert.match(text, /HEARD: Approve Galactic Bagels/);
  assert.match(text, /HOST: Commander — Company name approved/);
  assert.match(text, /not legal advice, not a filing/);
  assert.match(text, /No email is sent/);
  assert.ok(text.includes(FILE_DISCLAIMER));
});

test("empty transcript is detectable", () => {
  assert.equal(hasTranscriptContent([]), false);
  assert.equal(hasTranscriptContent([{ role: "host", text: "   " }]), false);
  const text = buildTranscriptFile([], company);
  assert.match(text, /not a filing/);
});

test("demo package contains both sections, the company name, and the disclaimer", () => {
  const entries = [
    { role: "you", text: "Pick Mars", at: 1 },
    { role: "host", text: "Commander — Mars is home.", at: 2 },
  ];
  const text = buildPackageFile(entries, prepared);
  assert.match(text, /demo package for Galactic Bagels/);
  assert.match(text, /===== LAWYER SUMMARY =====/);
  assert.match(text, /Galactic Bagels Inc\. \(fictional\) — Mars/);
  assert.match(text, /===== FULL TRANSCRIPT =====/);
  assert.match(text, /HEARD: Pick Mars/);
  assert.match(text, /HOST: Commander — Mars is home/);
  assert.match(text, /not legal advice, not a filing/);
  assert.ok(text.includes(FILE_DISCLAIMER));
  assert.match(text, /End of demo package/);
});

test("planDownload says why when there is nothing to save", async () => {
  const { planDownload } = await import("../lib/downloads.ts");
  const empty = { companyName: "Galactic Bagels Inc. (fictional)", lawyerPackage: "" };
  assert.deepEqual(planDownload("summary", empty, []), { ok: false, line: "No lawyer summary yet. Prepare the summary first." });
  assert.deepEqual(planDownload("transcript", empty, []), { ok: false, line: "No transcript yet. Say something first." });
  assert.equal(planDownload("package", empty, []).ok, false);
});

test("planDownload names each file for the company and fills it", async () => {
  const { planDownload, downloadedLine } = await import("../lib/downloads.ts");
  const state = { companyName: "Galactic Bagels Inc. (fictional)", lawyerPackage: "Summary body" };
  const entries = [{ role: "you", text: "Pick Mars", at: 1 }];
  const summary = planDownload("summary", state, entries);
  assert.equal(summary.ok, true);
  assert.equal(summary.filename, "galactic-bagels-summary.txt");
  assert.equal(summary.text, "Summary body");
  const transcript = planDownload("transcript", state, entries);
  assert.equal(transcript.filename, "galactic-bagels-transcript.txt");
  assert.match(transcript.text, /Pick Mars/);
  const pkg = planDownload("package", state, entries);
  assert.equal(pkg.filename, "galactic-bagels-demo-package.txt");
  assert.match(pkg.text, /Summary body/);
  assert.match(pkg.text, /Pick Mars/);
  assert.equal(downloadedLine(pkg.filename), "Downloaded galactic-bagels-demo-package.txt.");
});

test("planDownload saves the package when only the transcript exists", async () => {
  const { planDownload } = await import("../lib/downloads.ts");
  const plan = planDownload("package", { companyName: "", lawyerPackage: "" }, [{ role: "host", text: "Hello", at: 1 }]);
  assert.equal(plan.ok, true);
});

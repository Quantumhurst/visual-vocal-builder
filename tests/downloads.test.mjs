import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FILE_DISCLAIMER,
  buildTranscriptFile,
  companyFileSlug,
  hasTranscriptContent,
  summaryFilename,
  summaryFilenameFor,
  transcriptFilename,
  transcriptFilenameFor,
} from "../lib/downloads.ts";

const company = { companyName: "Galactic Bagels Inc. (fictional)" };

test("file names are built from the company", () => {
  assert.equal(companyFileSlug("Galactic Bagels Inc. (fictional)"), "galactic-bagels");
  assert.equal(companyFileSlug("Cosmic Donuts (fictional)"), "cosmic-donuts");
  assert.equal(companyFileSlug(""), "galactic-bagels");
  assert.equal(companyFileSlug("!!!"), "galactic-bagels");
  assert.equal(summaryFilename(company), "galactic-bagels-summary.txt");
  assert.equal(transcriptFilename(company), "galactic-bagels-transcript.txt");
  assert.equal(summaryFilenameFor("Acme Rockets (fictional)"), "acme-rockets-summary.txt");
  assert.equal(transcriptFilenameFor("Acme Rockets (fictional)"), "acme-rockets-transcript.txt");
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

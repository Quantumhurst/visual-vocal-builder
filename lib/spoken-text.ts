// What the agent may say out loud — pure, unit-testable.
// Only the host line is ever spoken (never grounded card bodies), and
// it is capped so a reply cannot ramble over the user's next command.
//
// Sentence splitting must not treat abbreviations as sentence ends:
// "Galactic Bagels Inc. (fictional)." and "s.85(1)" are single ideas.
// Without this guard the two-sentence cap silently dropped the actual
// next question after "Inc." or split "s.85" into "s. 85".

const ABBREVIATION = /\b(Inc|Ltd|Corp|Co|s|No|Dr|Mr|Mrs|Ms)\./g;

export function spokenHostText(text: string): string {
  const clean = (text ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  // Protect abbreviation dots and decimal points, then split only on
  // punctuation that is followed by whitespace or the end of the line.
  const guarded = clean
    .replace(ABBREVIATION, "$1\u0001")
    .replace(/(\d)\.(\d)/g, "$1\u0002$2");
  // Split at punctuation only when whitespace or end-of-line follows.
  // A filename such as "galactic-bagels-summary.txt." must stay whole;
  // the old regex could start a match after the dot and drop the prefix.
  const sentences = guarded
    .split(/(?<=[.!?])(?=\s|$)/)
    .map((s) => s.replace(/\u0001/g, ".").replace(/\u0002/g, ".").trim())
    .filter(Boolean);
  const capped = sentences.slice(0, 2).join(" ") || clean;
  return capped.length > 283 ? `${capped.slice(0, 280).trimEnd()}...` : capped;
}

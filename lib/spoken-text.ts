// What the agent may say out loud — pure, unit-testable.
// Only the host line is ever spoken (never grounded card bodies), and
// it is capped so a reply cannot ramble over the user's next command.

export function spokenHostText(text: string): string {
  const clean = (text ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const sentences = (clean.match(/[^.!?]+[.!?]+/g) ?? [clean]).map((s) => s.trim());
  const capped = sentences.slice(0, 2).join(" ") || clean;
  return capped.length > 283 ? `${capped.slice(0, 280).trimEnd()}...` : capped;
}
